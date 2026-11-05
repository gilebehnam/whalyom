<?php
/**
 * Plugin Name:       Whalyom
 * Plugin URI:        https://github.com/whalyom
 * Description:       First-party, cookieless analytics and lead capture for Whalyom, plus a signed, read-only REST endpoint the Whalyom hub reads (health and events).
 * Version:           1.2.0
 * Requires at least: 6.3
 * Requires PHP:      7.4
 * Author:            Whalyom
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       whalyom
 *
 * REST routes (namespace whalyom/v1):
 *   POST /wp-json/whalyom/v1/collect  public beacon for the tracker (rate-limited, de-duplicated, honeypot, Origin allow-list)
 *   GET  /wp-json/whalyom/v1/health   signed: x-whalyom-ts, x-whalyom-nonce, x-whalyom-sig = HMAC-SHA256(secret, ts\nnonce\nMETHOD\npath+query\nbody)
 *   GET  /wp-json/whalyom/v1/events   signed, ?since=<ISO time>
 *   GET  /wp-json/whalyom/v1/boosters public: the on-site boosters the owner approved (lead capture, sticky CTA,
 *                                      announcement, structured data), loaded by the tracker
 *   POST /wp-json/whalyom/v1/boosters signed: the hub replaces the approved booster list (stored as an option)
 * The plugin never writes site files and has no apply endpoint.
 *
 * @package Whalyom
 */

defined( 'ABSPATH' ) || exit;

define( 'WHALYOM_VERSION', '1.2.0' );
define( 'WHALYOM_OPTION', 'whalyom_settings' );
define( 'WHALYOM_DB_VERSION', '1' );

/**
 * Main plugin class.
 */
final class Whalyom_Plugin {

	const REST_NS     = 'whalyom/v1';
	const MAX_BODY    = 8000;
	const MAX_SKEW_MS = 300000;
	const TYPES       = array( 'pageview', 'lead', 'conversion', 'click', 'signup', 'checkout', 'scroll', 'cta', 'form_submit', 'outbound', 'vitals' );

	/**
	 * Nonce of the signed request being served (used to sign the response).
	 *
	 * @var string|null
	 */
	private static $signed_nonce = null;

	/**
	 * Hooks.
	 */
	public static function init() {
		add_action( 'wp_enqueue_scripts', array( __CLASS__, 'enqueue' ) );
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
		add_filter( 'rest_pre_serve_request', array( __CLASS__, 'serve_signed' ), 10, 4 );
		add_action( 'admin_menu', array( __CLASS__, 'admin_menu' ) );
		add_action( 'admin_init', array( __CLASS__, 'register_settings' ) );
		add_filter( 'plugin_action_links_' . plugin_basename( __FILE__ ), array( __CLASS__, 'action_links' ) );
		add_action( 'plugins_loaded', array( __CLASS__, 'maybe_upgrade' ) );
	}

	/**
	 * Events table name.
	 *
	 * @return string
	 */
	public static function table() {
		global $wpdb;
		return $wpdb->prefix . 'whalyom_events';
	}

	/**
	 * Default settings.
	 *
	 * @return array
	 */
	public static function defaults() {
		return array(
			'site_id'          => '',
			'secret'           => '',
			'consent_required' => 0,
			'respect_dnt'      => 1,
			'track_editors'    => 0,
			'origins'          => '',
			'retention_days'   => 180,
		);
	}

	/**
	 * Current settings merged with defaults.
	 *
	 * @return array
	 */
	public static function settings() {
		$saved = get_option( WHALYOM_OPTION, array() );
		return wp_parse_args( is_array( $saved ) ? $saved : array(), self::defaults() );
	}

	/**
	 * Activation: create the events table and default settings.
	 */
	public static function activate() {
		self::create_table();
		add_option( WHALYOM_OPTION, self::defaults(), '', false );
		if ( ! wp_next_scheduled( 'whalyom_prune' ) ) {
			wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', 'whalyom_prune' );
		}
	}

	/**
	 * Deactivation: stop the prune job (data stays until uninstall).
	 */
	public static function deactivate() {
		wp_clear_scheduled_hook( 'whalyom_prune' );
	}

	/**
	 * Creates or upgrades the events table.
	 */
	public static function create_table() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$table   = self::table();
		$charset = $wpdb->get_charset_collate();
		$sql     = "CREATE TABLE {$table} (
  id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  at varchar(30) NOT NULL,
  eid varchar(40) DEFAULT NULL,
  type varchar(20) NOT NULL,
  data longtext NOT NULL,
  PRIMARY KEY  (id),
  UNIQUE KEY eid (eid),
  KEY at (at)
) {$charset};";
		dbDelta( $sql );
		update_option( 'whalyom_db_version', WHALYOM_DB_VERSION, false );
	}

	/**
	 * Runs the table upgrade when the schema version changed.
	 */
	public static function maybe_upgrade() {
		if ( get_option( 'whalyom_db_version' ) !== WHALYOM_DB_VERSION ) {
			self::create_table();
		}
	}

	/**
	 * Deletes events older than the retention window.
	 */
	public static function prune() {
		global $wpdb;
		$days   = max( 1, (int) self::settings()['retention_days'] );
		$cutoff = gmdate( 'Y-m-d\TH:i:s', time() - $days * DAY_IN_SECONDS );
		$table  = self::table();
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is internal.
		$wpdb->query( $wpdb->prepare( "DELETE FROM {$table} WHERE at < %s", $cutoff ) );
	}

	/* ---------------------------------------------------------------- front end */

	/**
	 * Enqueues the tracker with its configuration.
	 */
	public static function enqueue() {
		$s = self::settings();
		if ( ! $s['track_editors'] && current_user_can( 'edit_posts' ) ) {
			return;
		}
		wp_enqueue_script(
			'whalyom',
			plugins_url( 'assets/whalyom.js', __FILE__ ),
			array(),
			WHALYOM_VERSION,
			array(
				'strategy'  => 'defer',
				'in_footer' => false,
			)
		);
		$config = array(
			'endpoint'   => esc_url_raw( rest_url( self::REST_NS . '/collect' ) ),
			'site'       => (string) $s['site_id'],
			'respectDnt' => (bool) $s['respect_dnt'],
			'boostScript' => esc_url_raw( plugins_url( 'assets/whalyom-boost.js', __FILE__ ) ),
		);
		if ( $s['consent_required'] ) {
			$config['consent'] = 'required';
		}
		wp_add_inline_script( 'whalyom', 'window.WHALYOM_CONFIG=' . wp_json_encode( $config ) . ';', 'before' );
	}

	/* ---------------------------------------------------------------- REST */

	/**
	 * Registers the REST routes.
	 */
	public static function register_routes() {
		register_rest_route(
			self::REST_NS,
			'/boosters',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => array( __CLASS__, 'rest_boosters' ),
					'permission_callback' => '__return_true', // Public: only owner-approved, sanitized boosters are ever returned.
				),
				array(
					'methods'             => 'POST',
					'callback'            => array( __CLASS__, 'rest_set_boosters' ),
					'permission_callback' => array( __CLASS__, 'check_signature' ),
				),
			)
		);
		register_rest_route(
			self::REST_NS,
			'/collect',
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'rest_collect' ),
				'permission_callback' => '__return_true', // Public beacon; protected by size limit, rate limit, Origin allow-list and validation.
			)
		);
		register_rest_route(
			self::REST_NS,
			'/health',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'rest_health' ),
				'permission_callback' => array( __CLASS__, 'check_signature' ),
			)
		);
		register_rest_route(
			self::REST_NS,
			'/events',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'rest_events' ),
				'permission_callback' => array( __CLASS__, 'check_signature' ),
				'args'                => array(
					'since' => array(
						'type'              => 'string',
						'default'           => '',
						'sanitize_callback' => array( __CLASS__, 'sanitize_since' ),
					),
					'limit' => array(
						'type'    => 'integer',
						'default' => 20000,
						'minimum' => 1,
						'maximum' => 20000,
					),
				),
			)
		);
	}

	/**
	 * Keeps only characters of an ISO timestamp.
	 *
	 * @param string $value Raw value.
	 * @return string
	 */
	public static function sanitize_since( $value ) {
		return substr( preg_replace( '/[^0-9TZ:.\-]/', '', (string) $value ), 0, 30 );
	}

	/**
	 * Client IP. Uses REMOTE_ADDR unless WHALYOM_TRUST_PROXY is defined (then the last X-Forwarded-For hop).
	 *
	 * @return string
	 */
	private static function client_ip() {
		$ip = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';
		if ( defined( 'WHALYOM_TRUST_PROXY' ) && WHALYOM_TRUST_PROXY && ! empty( $_SERVER['HTTP_X_FORWARDED_FOR'] ) ) {
			$hops = array_filter( array_map( 'trim', explode( ',', sanitize_text_field( wp_unslash( $_SERVER['HTTP_X_FORWARDED_FOR'] ) ) ) ) );
			if ( $hops ) {
				$ip = end( $hops );
			}
		}
		return filter_var( $ip, FILTER_VALIDATE_IP ) ? $ip : '0.0.0.0';
	}

	/**
	 * Sliding-window-ish rate limit with transients. Returns true when over the limit.
	 *
	 * @param string $bucket Bucket name.
	 * @param int    $limit  Max hits per window.
	 * @param int    $window Window in seconds.
	 * @param bool   $count  Whether this call counts as a hit.
	 * @return bool
	 */
	private static function limited( $bucket, $limit, $window, $count = true ) {
		$key  = 'whalyom_rl_' . $bucket . '_' . substr( hash_hmac( 'sha256', self::client_ip(), wp_salt( 'nonce' ) ), 0, 20 );
		$data = get_transient( $key );
		$now  = time();
		if ( ! is_array( $data ) || $data['until'] < $now ) {
			$data = array(
				'n'     => 0,
				'until' => $now + $window,
			);
		}
		if ( $count ) {
			++$data['n'];
			set_transient( $key, $data, max( 1, $data['until'] - $now ) );
		}
		return $data['n'] > $limit;
	}

	/**
	 * Allowed origins: the site's own origin plus the configured list.
	 *
	 * @return string[]
	 */
	private static function allowed_origins() {
		$out  = array();
		$home = wp_parse_url( home_url() );
		if ( ! empty( $home['host'] ) ) {
			$out[] = strtolower( ( isset( $home['scheme'] ) ? $home['scheme'] : 'https' ) . '://' . $home['host'] . ( isset( $home['port'] ) ? ':' . $home['port'] : '' ) );
		}
		foreach ( preg_split( '/[\s,]+/', (string) self::settings()['origins'] ) as $o ) {
			$o = strtolower( untrailingslashit( trim( $o ) ) );
			if ( $o ) {
				$out[] = $o;
			}
		}
		return array_values( array_unique( $out ) );
	}

	/**
	 * Cleans a string like the Node satellite does.
	 *
	 * @param mixed $v Value.
	 * @param int   $n Max length.
	 * @return string
	 */
	private static function str( $v, $n ) {
		if ( null === $v || is_array( $v ) || is_object( $v ) ) {
			return '';
		}
		if ( is_bool( $v ) ) {
			$v = $v ? 'true' : 'false';
		}
		$v = preg_replace( '/[\x00-\x1F\x7F]/u', ' ', (string) $v );
		if ( null === $v ) {
			return ''; // Invalid UTF-8.
		}
		$v = trim( $v );
		return function_exists( 'mb_substr' ) ? mb_substr( $v, 0, $n ) : substr( $v, 0, $n );
	}

	/**
	 * Number within bounds, or null.
	 *
	 * @param mixed $v   Value.
	 * @param float $min Min.
	 * @param float $max Max.
	 * @return float|int|null
	 */
	private static function num( $v, $min, $max ) {
		if ( null === $v || '' === $v || is_array( $v ) || is_bool( $v ) || ! is_numeric( $v ) ) {
			return null;
		}
		$n = $v + 0;
		return ( is_finite( $n ) && $n >= $min && $n <= $max ) ? $n : null;
	}

	/**
	 * Origin + path of an http(s) URL, or ''.
	 *
	 * @param mixed $v Value.
	 * @return string
	 */
	private static function clean_url( $v ) {
		$s = self::str( $v, 500 );
		if ( '' === $s ) {
			return '';
		}
		$u = wp_parse_url( $s );
		if ( empty( $u['scheme'] ) || ! in_array( strtolower( $u['scheme'] ), array( 'http', 'https' ), true ) || empty( $u['host'] ) ) {
			return '';
		}
		$out = strtolower( $u['scheme'] ) . '://' . strtolower( $u['host'] ) . ( isset( $u['port'] ) ? ':' . $u['port'] : '' ) . ( isset( $u['path'] ) && '' !== $u['path'] ? $u['path'] : '/' );
		return substr( $out, 0, 300 );
	}

	/**
	 * Validates and trims one event (same rules as normalizeEvent in whalyom-satellite.mjs).
	 *
	 * @param mixed $ev Decoded JSON.
	 * @return array{error?:string,drop?:string,event?:array}
	 */
	public static function normalize_event( $ev ) {
		if ( ! is_array( $ev ) || ( array_keys( $ev ) === range( 0, count( $ev ) - 1 ) && count( $ev ) > 0 ) ) {
			return array( 'error' => 'bad event' );
		}
		$type = self::str( isset( $ev['type'] ) ? $ev['type'] : '', 20 );
		if ( ! in_array( $type, self::TYPES, true ) ) {
			return array( 'error' => 'unknown type' );
		}
		if ( '' !== self::str( isset( $ev['hp'] ) ? $ev['hp'] : '', 200 ) ) {
			return array( 'drop' => 'honeypot' );
		}
		$u   = isset( $ev['utm'] ) && is_array( $ev['utm'] ) ? $ev['utm'] : array();
		$utm = array(
			'source'   => self::str( isset( $u['source'] ) ? $u['source'] : '', 80 ),
			'medium'   => self::str( isset( $u['medium'] ) ? $u['medium'] : '', 80 ),
			'campaign' => self::str( isset( $u['campaign'] ) ? $u['campaign'] : '', 120 ),
		);
		$term    = self::str( isset( $u['term'] ) ? $u['term'] : '', 120 );
		$content = self::str( isset( $u['content'] ) ? $u['content'] : '', 120 );
		if ( '' !== $term ) {
			$utm['term'] = $term;
		}
		if ( '' !== $content ) {
			$utm['content'] = $content;
		}
		$path  = preg_split( '/[?#]/', self::str( isset( $ev['path'] ) ? $ev['path'] : '', 300 ) );
		$micro = microtime( true );
		$out   = array(
			'at'   => gmdate( 'Y-m-d\TH:i:s', (int) $micro ) . sprintf( '.%03dZ', (int) ( ( $micro - floor( $micro ) ) * 1000 ) ),
			'type' => $type,
			'path' => $path[0],
			'ref'  => self::clean_url( isset( $ev['ref'] ) ? $ev['ref'] : '' ),
			'utm'  => $utm,
		);
		$eid   = self::str( isset( $ev['eid'] ) ? $ev['eid'] : '', 40 );
		if ( preg_match( '/^[A-Za-z0-9_-]{8,40}$/', $eid ) ) {
			$out['eid'] = $eid;
		}
		$site = self::str( isset( $ev['site'] ) ? $ev['site'] : '', 60 );
		if ( '' !== $site ) {
			$out['site'] = $site;
		}
		if ( in_array( $type, array( 'conversion', 'checkout', 'signup', 'lead' ), true ) ) {
			$v = self::num( isset( $ev['value'] ) ? $ev['value'] : null, 0, 1e9 );
			if ( null !== $v ) {
				$out['value'] = $v;
			}
		}
		if ( isset( $ev['form'] ) && '' !== $ev['form'] ) {
			$out['form'] = self::str( $ev['form'], 60 );
		}
		if ( 'scroll' === $type ) {
			$d = self::num( isset( $ev['depth'] ) ? $ev['depth'] : null, 0, 100 );
			if ( null === $d ) {
				return array( 'error' => 'bad depth' );
			}
			$out['depth'] = (int) round( $d );
		}
		if ( 'cta' === $type || 'click' === $type ) {
			$l = self::str( isset( $ev['label'] ) ? $ev['label'] : '', 80 );
			if ( '' !== $l ) {
				$out['label'] = $l;
			}
		}
		if ( 'outbound' === $type ) {
			$h     = preg_replace( '#^https?://#i', '', self::str( isset( $ev['href'] ) ? $ev['href'] : '', 300 ) );
			$parts = preg_split( '#[/?\#]#', $h );
			$h     = strtolower( $parts[0] );
			if ( ! preg_match( '/^[a-z0-9.-]+(:\d+)?$/', $h ) ) {
				return array( 'error' => 'bad href' );
			}
			$out['href'] = $h;
		}
		if ( 'vitals' === $type ) {
			$lcp = self::num( isset( $ev['lcp'] ) ? $ev['lcp'] : null, 0, 120000 );
			$cls = self::num( isset( $ev['cls'] ) ? $ev['cls'] : null, 0, 100 );
			$inp = self::num( isset( $ev['inp'] ) ? $ev['inp'] : null, 0, 120000 );
			if ( null === $lcp && null === $cls && null === $inp ) {
				return array( 'error' => 'no vitals' );
			}
			if ( null !== $lcp ) {
				$out['lcp'] = (int) round( $lcp );
			}
			if ( null !== $cls ) {
				$out['cls'] = round( $cls, 3 );
			}
			if ( null !== $inp ) {
				$out['inp'] = (int) round( $inp );
			}
		}
		if ( 'lead' === $type || 'signup' === $type ) {
			$c       = array();
			$consent = isset( $ev['consent'] ) && true === $ev['consent'];
			$email   = $consent ? strtolower( self::str( isset( $ev['email'] ) ? $ev['email'] : '', 254 ) ) : '';
			if ( '' !== $email && is_email( $email ) ) {
				$c['email'] = $email;
			}
			foreach ( array(
				'name'    => 120,
				'company' => 120,
				'message' => 1000,
			) as $k => $len ) {
				$val = $consent ? self::str( isset( $ev[ $k ] ) ? $ev[ $k ] : '', $len ) : '';
				if ( '' !== $val ) {
					$c[ $k ] = $val;
				}
			}
			$phone = $consent ? preg_replace( '/[^0-9+()\-. ]/', '', self::str( isset( $ev['phone'] ) ? $ev['phone'] : '', 40 ) ) : '';
			if ( strlen( preg_replace( '/\D/', '', $phone ) ) >= 5 ) {
				$c['phone'] = $phone;
			}
			if ( $c ) {
				$out['contact'] = $c;
				$out['consent'] = true;
			}
			if ( ! empty( $ev['fast'] ) ) {
				$out['bot_hint'] = 'fast-submit';
			}
		}
		return array( 'event' => $out );
	}

	/**
	 * POST /collect.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public static function rest_collect( WP_REST_Request $request ) {
		$origin  = strtolower( untrailingslashit( (string) $request->get_header( 'origin' ) ) );
		$headers = array( 'Vary' => 'Origin' );
		if ( '' !== $origin ) {
			if ( ! in_array( $origin, self::allowed_origins(), true ) ) {
				return new WP_REST_Response( array( 'error' => 'origin not allowed' ), 403, $headers );
			}
			$headers['Access-Control-Allow-Origin'] = esc_url_raw( $origin );
		}
		if ( self::limited( 'c', 120, MINUTE_IN_SECONDS ) ) {
			return new WP_REST_Response( array( 'error' => 'slow down' ), 429, $headers + array( 'Retry-After' => '60' ) );
		}
		$body = (string) $request->get_body();
		if ( strlen( $body ) > self::MAX_BODY ) {
			return new WP_REST_Response( array( 'error' => 'body too large' ), 413, $headers );
		}
		$ev = json_decode( $body, true );
		if ( null === $ev && JSON_ERROR_NONE !== json_last_error() ) {
			return new WP_REST_Response( array( 'error' => 'bad json' ), 400, $headers );
		}
		$r = self::normalize_event( $ev );
		if ( isset( $r['error'] ) ) {
			return new WP_REST_Response( array( 'error' => $r['error'] ), 400, $headers );
		}
		if ( isset( $r['drop'] ) ) {
			return new WP_REST_Response( null, 204, $headers );
		}
		$event = $r['event'];
		global $wpdb;
		$table = self::table();
		if ( isset( $event['eid'] ) ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is internal.
			$dupe = $wpdb->get_var( $wpdb->prepare( "SELECT id FROM {$table} WHERE eid = %s", $event['eid'] ) );
			if ( $dupe ) {
				return new WP_REST_Response( null, 204, $headers );
			}
		}
		if ( in_array( $event['type'], array( 'lead', 'signup' ), true ) && self::limited( 'l', 5, 10 * MINUTE_IN_SECONDS ) ) {
			return new WP_REST_Response( array( 'error' => 'too many leads' ), 429, $headers + array( 'Retry-After' => '600' ) );
		}
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery -- custom table, insert only.
		$wpdb->insert(
			$table,
			array(
				'at'   => $event['at'],
				'eid'  => isset( $event['eid'] ) ? $event['eid'] : null,
				'type' => $event['type'],
				'data' => wp_json_encode( $event ),
			),
			array( '%s', '%s', '%s', '%s' )
		);
		return new WP_REST_Response( null, 204, $headers );
	}

	/**
	 * Permission callback for signed routes: timestamp window, nonce (once only), HMAC (constant time).
	 *
	 * @param WP_REST_Request $request Request.
	 * @return true|WP_Error
	 */
	public static function check_signature( WP_REST_Request $request ) {
		$secret = (string) self::settings()['secret'];
		if ( strlen( $secret ) < 32 ) {
			return new WP_Error( 'whalyom_not_configured', __( 'Whalyom is not configured: set the secret in Settings → Whalyom.', 'whalyom' ), array( 'status' => 503 ) );
		}
		if ( self::limited( 's', 20, MINUTE_IN_SECONDS, false ) ) {
			return new WP_Error( 'whalyom_slow_down', 'slow down', array( 'status' => 429 ) );
		}
		$deny  = new WP_Error(
			'whalyom_bad_signature',
			'bad signature',
			array(
				'status'       => 401,
				'sig_versions' => array( 2 ),
			)
		);
		$ts    = (string) $request->get_header( 'x_whalyom_ts' );
		$nonce = (string) $request->get_header( 'x_whalyom_nonce' );
		$sig   = strtolower( (string) $request->get_header( 'x_whalyom_sig' ) );
		$now   = (int) round( microtime( true ) * 1000 );
		if ( ! preg_match( '/^\d{10,16}$/', $ts ) || abs( $now - (int) $ts ) > self::MAX_SKEW_MS || ! preg_match( '/^[A-Za-z0-9_-]{16,64}$/', $nonce ) || ! preg_match( '/^[0-9a-f]{64}$/', $sig ) ) {
			self::limited( 's', 20, MINUTE_IN_SECONDS );
			return $deny;
		}
		// The signature covers the exact path and query the hub sent, so the raw REQUEST_URI is compared, not a sanitized copy.
		// phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- only used inside the HMAC, never output or stored.
		$path = isset( $_SERVER['REQUEST_URI'] ) ? wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
		$want = hash_hmac( 'sha256', $ts . "\n" . $nonce . "\n" . $request->get_method() . "\n" . $path . "\n" . $request->get_body(), $secret );
		if ( ! hash_equals( $want, $sig ) ) {
			self::limited( 's', 20, MINUTE_IN_SECONDS );
			return $deny;
		}
		$nkey = 'whalyom_n_' . md5( $nonce );
		if ( false !== get_transient( $nkey ) ) {
			return new WP_Error(
				'whalyom_replayed',
				'replayed request',
				array(
					'status'       => 401,
					'sig_versions' => array( 2 ),
				)
			);
		}
		set_transient( $nkey, 1, 2 * self::MAX_SKEW_MS / 1000 + 60 );
		self::$signed_nonce = $nonce;
		return true;
	}

	/**
	 * GET /health.
	 *
	 * @return WP_REST_Response
	 */
	public static function rest_boosters() {
		$items = self::sanitize_boosters( get_option( 'whalyom_boosters', array() ) );
		$res   = new WP_REST_Response(
			array(
				'items'  => $items,
				'script' => esc_url_raw( plugins_url( 'assets/whalyom-boost.js', __FILE__ ) ),
			),
			200
		);
		$res->header( 'Cache-Control', 'public, max-age=300' );
		$res->header( 'Access-Control-Allow-Origin', '*' );
		return $res;
	}

	/**
	 * POST /boosters (signed): the hub sends the full list of approved boosters.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public static function rest_set_boosters( WP_REST_Request $request ) {
		$body  = json_decode( (string) $request->get_body(), true );
		$items = is_array( $body ) && isset( $body['items'] ) && is_array( $body['items'] ) ? $body['items'] : array();
		foreach ( $items as $i => $b ) {
			if ( is_array( $b ) ) {
				$items[ $i ]['approved'] = true;
			}
		}
		$clean = self::sanitize_boosters( $items );
		update_option( 'whalyom_boosters', $clean, false );
		return new WP_REST_Response( array( 'ok' => true, 'live' => count( $clean ) ), 200 );
	}

	/**
	 * Mirror of liveBoosters() in tools/satellite/whalyom-satellite.mjs: approved, well-formed items only,
	 * text clipped, URLs http(s) or site-relative, at most 10.
	 *
	 * @param mixed $list Stored or posted list.
	 * @return array
	 */
	public static function sanitize_boosters( $list ) {
		$types = array( 'lead-capture', 'sticky-cta', 'announcement', 'schema' );
		$out   = array();
		$t     = function ( $v, $n ) {
			return is_string( $v ) ? substr( trim( preg_replace( '/[ -]/', ' ', $v ) ), 0, $n ) : null;
		};
		$u     = function ( $v ) use ( $t ) {
			$s = $t( $v, 500 );
			if ( ! $s ) {
				return null;
			}
			if ( 0 === strpos( $s, '/' ) && 0 !== strpos( $s, '//' ) ) {
				return $s;
			}
			return preg_match( '#^https?://#i', $s ) && false !== filter_var( $s, FILTER_VALIDATE_URL ) ? $s : null;
		};
		$color = function ( $v ) {
			return is_string( $v ) && preg_match( '/^#[0-9a-fA-F]{3,8}$/', $v ) ? $v : null;
		};
		$paths = function ( $v ) use ( $t ) {
			if ( ! is_array( $v ) ) {
				return null;
			}
			$r = array();
			foreach ( array_slice( $v, 0, 20 ) as $p ) {
				$p = $t( $p, 120 );
				if ( $p && 0 === strpos( $p, '/' ) ) {
					$r[] = $p;
				}
			}
			return $r;
		};
		foreach ( is_array( $list ) ? $list : array() as $b ) {
			if ( ! is_array( $b ) || true !== ( isset( $b['approved'] ) ? $b['approved'] : false ) || ! in_array( isset( $b['type'] ) ? $b['type'] : '', $types, true ) || ! preg_match( '/^[A-Za-z0-9_-]{1,40}$/', (string) ( isset( $b['id'] ) ? $b['id'] : '' ) ) ) {
				continue;
			}
			if ( ! empty( $b['expires_at'] ) && strtotime( $b['expires_at'] ) && strtotime( $b['expires_at'] ) < time() ) {
				continue;
			}
			$o = array( 'id' => $b['id'], 'type' => $b['type'], 'include' => $paths( isset( $b['include'] ) ? $b['include'] : null ), 'exclude' => $paths( isset( $b['exclude'] ) ? $b['exclude'] : null ), 'bg' => $color( isset( $b['bg'] ) ? $b['bg'] : null ), 'fg' => $color( isset( $b['fg'] ) ? $b['fg'] : null ), 'accent' => $color( isset( $b['accent'] ) ? $b['accent'] : null ) );
			if ( 'schema' === $b['type'] ) {
				if ( empty( $b['jsonld'] ) || ! is_array( $b['jsonld'] ) || strlen( wp_json_encode( $b['jsonld'] ) ) > 20000 ) {
					continue;
				}
				$o['jsonld'] = $b['jsonld'];
			} else {
				$g = function ( $k ) use ( $b ) {
					return isset( $b[ $k ] ) ? $b[ $k ] : null;
				};
				$o += array( 'text' => $t( $g( 'text' ), 280 ), 'button' => $t( $g( 'button' ), 40 ), 'url' => $u( $g( 'url' ) ), 'link_text' => $t( $g( 'link_text' ), 40 ), 'label' => $t( $g( 'label' ), 60 ) );
				if ( 'lead-capture' === $b['type'] ) {
					$o += array( 'headline' => $t( $g( 'headline' ), 90 ), 'placeholder' => $t( $g( 'placeholder' ), 60 ), 'consent_text' => $t( $g( 'consent_text' ), 280 ), 'privacy_url' => $u( $g( 'privacy_url' ) ), 'success' => $t( $g( 'success' ), 160 ), 'trigger' => 'delay' === $g( 'trigger' ) ? 'delay' : 'exit', 'delay_s' => min( 600, max( 3, (int) $g( 'delay_s' ) ? (int) $g( 'delay_s' ) : 30 ) ) );
					if ( ! $o['consent_text'] ) {
						continue;
					}
				}
			}
			$out[] = array_filter( $o, function ( $v ) { return null !== $v && '' !== $v; } );
			if ( count( $out ) >= 10 ) {
				break;
			}
		}
		return $out;
	}

	/**
	 * GET /health.
	 *
	 * @return WP_REST_Response
	 */
	public static function rest_health() {
		global $wpdb;
		$table = self::table();
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is internal.
		$count = (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$table}" );
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is internal.
		$last = $wpdb->get_var( "SELECT MAX(at) FROM {$table}" );
		return new WP_REST_Response(
			array(
				'ok'           => true,
				'version'      => WHALYOM_VERSION,
				'kind'         => 'wordpress',
				'root'         => (string) self::settings()['site_id'],
				'writes'       => false,
				'strict'       => true,
				'events'       => $count,
				'last_event'   => $last ? $last : null,
				'time'         => (int) round( microtime( true ) * 1000 ),
				'php'          => PHP_VERSION,
				'wp'           => get_bloginfo( 'version' ),
				'sig_versions' => array( 2 ),
				'origins'      => count( self::allowed_origins() ),
			),
			200
		);
	}

	/**
	 * GET /events.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response
	 */
	public static function rest_events( WP_REST_Request $request ) {
		global $wpdb;
		$since = (string) $request->get_param( 'since' );
		$limit = min( 20000, max( 1, (int) $request->get_param( 'limit' ) ) );
		$table = self::table();
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is internal.
		$rows   = $wpdb->get_col( $wpdb->prepare( "SELECT data FROM {$table} WHERE at > %s ORDER BY id ASC LIMIT %d", $since, $limit ) );
		$events = array();
		foreach ( (array) $rows as $row ) {
			$e = json_decode( $row, true );
			if ( is_array( $e ) ) {
				$events[] = $e;
			}
		}
		$until = $events ? $events[ count( $events ) - 1 ]['at'] : $since;
		return new WP_REST_Response(
			array(
				'events' => $events,
				'until'  => $until,
			),
			200
		);
	}

	/**
	 * Serves signed routes ourselves so the response body that is signed is exactly the body sent.
	 *
	 * @param bool             $served  Whether the request was served.
	 * @param WP_HTTP_Response $result  Result.
	 * @param WP_REST_Request  $request Request.
	 * @param WP_REST_Server   $server  Server.
	 * @return bool
	 */
	public static function serve_signed( $served, $result, $request, $server ) {
		if ( $served || null === self::$signed_nonce || ! ( $result instanceof WP_HTTP_Response ) ) {
			return $served;
		}
		if ( 0 !== strpos( (string) $request->get_route(), '/' . self::REST_NS . '/' ) || 200 !== $result->get_status() ) {
			return $served;
		}
		$body = wp_json_encode( $result->get_data() );
		$sig  = hash_hmac( 'sha256', "resp\n" . self::$signed_nonce . "\n200\n" . $body, (string) self::settings()['secret'] );
		if ( ! headers_sent() ) {
			header( 'X-Whalyom-Resp-Sig: ' . $sig );
			header( 'Cache-Control: no-store' );
		}
		echo $body; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- JSON response body.
		return true;
	}

	/* ---------------------------------------------------------------- admin */

	/**
	 * Settings page entry.
	 */
	public static function admin_menu() {
		add_options_page( __( 'Whalyom', 'whalyom' ), __( 'Whalyom', 'whalyom' ), 'manage_options', 'whalyom', array( __CLASS__, 'render_settings' ) );
	}

	/**
	 * Settings link on the plugins screen.
	 *
	 * @param array $links Links.
	 * @return array
	 */
	public static function action_links( $links ) {
		$links[] = '<a href="' . esc_url( admin_url( 'options-general.php?page=whalyom' ) ) . '">' . esc_html__( 'Settings', 'whalyom' ) . '</a>';
		return $links;
	}

	/**
	 * Registers the option with its sanitize callback (the Settings API adds the nonce and capability check).
	 */
	public static function register_settings() {
		register_setting(
			'whalyom',
			WHALYOM_OPTION,
			array(
				'type'              => 'array',
				'sanitize_callback' => array( __CLASS__, 'sanitize_settings' ),
				'default'           => self::defaults(),
				'show_in_rest'      => false,
			)
		);
	}

	/**
	 * Sanitizes the settings form.
	 *
	 * @param mixed $input Raw input.
	 * @return array
	 */
	public static function sanitize_settings( $input ) {
		$old = self::settings();
		if ( ! current_user_can( 'manage_options' ) || ! is_array( $input ) ) {
			return $old;
		}
		$out                     = $old;
		$out['site_id']          = substr( sanitize_key( isset( $input['site_id'] ) ? $input['site_id'] : '' ), 0, 60 );
		$out['consent_required'] = empty( $input['consent_required'] ) ? 0 : 1;
		$out['respect_dnt']      = empty( $input['respect_dnt'] ) ? 0 : 1;
		$out['track_editors']    = empty( $input['track_editors'] ) ? 0 : 1;
		$out['retention_days']   = min( 3650, max( 1, absint( isset( $input['retention_days'] ) ? $input['retention_days'] : 180 ) ) );
		$origins                 = array();
		foreach ( preg_split( '/[\s,]+/', (string) ( isset( $input['origins'] ) ? $input['origins'] : '' ) ) as $o ) {
			$u = wp_parse_url( esc_url_raw( trim( $o ) ) );
			if ( ! empty( $u['scheme'] ) && ! empty( $u['host'] ) && in_array( $u['scheme'], array( 'http', 'https' ), true ) ) {
				$origins[] = $u['scheme'] . '://' . strtolower( $u['host'] ) . ( isset( $u['port'] ) ? ':' . (int) $u['port'] : '' );
			}
		}
		$out['origins'] = implode( "\n", array_unique( $origins ) );
		$secret         = isset( $input['secret'] ) ? trim( (string) $input['secret'] ) : '';
		if ( ! empty( $input['clear_secret'] ) ) {
			$out['secret'] = '';
		} elseif ( '' !== $secret ) {
			if ( preg_match( '/^[A-Za-z0-9_-]{32,128}$/', $secret ) ) {
				$out['secret'] = $secret;
			} else {
				add_settings_error( WHALYOM_OPTION, 'whalyom_secret', __( 'The secret must be 32–128 letters, digits, "-" or "_". It was not changed.', 'whalyom' ) );
			}
		}
		return $out;
	}

	/**
	 * Renders the settings page.
	 */
	public static function render_settings() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$s   = self::settings();
		$opt = WHALYOM_OPTION;
		global $wpdb;
		$table = self::table();
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- table name is internal.
		$count = (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$table}" );
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Whalyom', 'whalyom' ); ?></h1>
			<p><?php esc_html_e( 'First-party, cookieless tracking and lead capture. The Whalyom hub reads events through a signed, read-only endpoint.', 'whalyom' ); ?></p>
			<?php settings_errors( WHALYOM_OPTION ); ?>
			<form method="post" action="options.php">
				<?php settings_fields( 'whalyom' ); ?>
				<table class="form-table" role="presentation">
					<tr>
						<th scope="row"><label for="whalyom_site_id"><?php esc_html_e( 'Site id', 'whalyom' ); ?></label></th>
						<td><input type="text" class="regular-text" id="whalyom_site_id" name="<?php echo esc_attr( $opt ); ?>[site_id]" value="<?php echo esc_attr( $s['site_id'] ); ?>" />
						<p class="description"><?php esc_html_e( 'The product slug in Whalyom (for example "example").', 'whalyom' ); ?></p></td>
					</tr>
					<tr>
						<th scope="row"><label for="whalyom_secret"><?php esc_html_e( 'Hub secret', 'whalyom' ); ?></label></th>
						<td><input type="password" class="regular-text" id="whalyom_secret" name="<?php echo esc_attr( $opt ); ?>[secret]" value="" autocomplete="new-password" placeholder="<?php echo esc_attr( $s['secret'] ? __( 'set (leave empty to keep)', 'whalyom' ) : __( 'not set', 'whalyom' ) ); ?>" />
						<label><input type="checkbox" name="<?php echo esc_attr( $opt ); ?>[clear_secret]" value="1" /> <?php esc_html_e( 'Remove the secret (disconnects the hub)', 'whalyom' ); ?></label>
						<p class="description"><?php esc_html_e( 'Paste the value of OM_SAT_SECRET_<SLUG> from the hub\'s .env file. It is never shown again.', 'whalyom' ); ?></p></td>
					</tr>
					<tr>
						<th scope="row"><?php esc_html_e( 'Privacy', 'whalyom' ); ?></th>
						<td>
							<label><input type="checkbox" name="<?php echo esc_attr( $opt ); ?>[respect_dnt]" value="1" <?php checked( $s['respect_dnt'] ); ?> /> <?php esc_html_e( 'Respect Do Not Track and Global Privacy Control', 'whalyom' ); ?></label><br />
							<label><input type="checkbox" name="<?php echo esc_attr( $opt ); ?>[consent_required]" value="1" <?php checked( $s['consent_required'] ); ?> /> <?php esc_html_e( 'Wait for consent (your banner calls whalyom.consent(true))', 'whalyom' ); ?></label><br />
							<label><input type="checkbox" name="<?php echo esc_attr( $opt ); ?>[track_editors]" value="1" <?php checked( $s['track_editors'] ); ?> /> <?php esc_html_e( 'Also track logged-in editors', 'whalyom' ); ?></label>
						</td>
					</tr>
					<tr>
						<th scope="row"><label for="whalyom_origins"><?php esc_html_e( 'Extra allowed origins', 'whalyom' ); ?></label></th>
						<td><textarea class="large-text" rows="3" id="whalyom_origins" name="<?php echo esc_attr( $opt ); ?>[origins]"><?php echo esc_textarea( $s['origins'] ); ?></textarea>
						<p class="description"><?php esc_html_e( 'One per line. This site\'s own origin is always allowed.', 'whalyom' ); ?></p></td>
					</tr>
					<tr>
						<th scope="row"><label for="whalyom_retention"><?php esc_html_e( 'Keep events (days)', 'whalyom' ); ?></label></th>
						<td><input type="number" min="1" max="3650" id="whalyom_retention" name="<?php echo esc_attr( $opt ); ?>[retention_days]" value="<?php echo esc_attr( (string) $s['retention_days'] ); ?>" /></td>
					</tr>
				</table>
				<?php submit_button(); ?>
			</form>
			<h2><?php esc_html_e( 'Status', 'whalyom' ); ?></h2>
			<ul>
				<li><?php echo esc_html( sprintf( /* translators: %d: number of events */ __( 'Events stored: %d', 'whalyom' ), $count ) ); ?></li>
				<li><?php esc_html_e( 'Hub endpoint:', 'whalyom' ); ?> <code><?php echo esc_html( rest_url( self::REST_NS . '/health' ) ); ?></code></li>
				<li><?php esc_html_e( 'Lead forms: add data-whalyom-lead="trial" to a form.', 'whalyom' ); ?></li>
			</ul>
		</div>
		<?php
	}
}

register_activation_hook( __FILE__, array( 'Whalyom_Plugin', 'activate' ) );
register_deactivation_hook( __FILE__, array( 'Whalyom_Plugin', 'deactivate' ) );
add_action( 'whalyom_prune', array( 'Whalyom_Plugin', 'prune' ) );
Whalyom_Plugin::init();
