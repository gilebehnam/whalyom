<?php
/**
 * Minimal WordPress stand-in so tools/test/satellite-stacks.test.mjs can run the plugin's logic with the
 * PHP CLI (no WordPress install needed). Reads one JSON job on stdin, prints a JSON result.
 *   {"op":"normalize","events":[...]}
 *   {"op":"signature","secret":"...","cases":[{"method":"GET","uri":"/wp-json/whalyom/v1/health","headers":{...},"body":""}]}
 *   {"op":"collect","home":"https://example.test","requests":[{"origin":"...","body":"..."}]}
 *
 * @package Whalyom
 */

// phpcs:disable
define( 'ABSPATH', __DIR__ . '/' );
define( 'MINUTE_IN_SECONDS', 60 );
define( 'HOUR_IN_SECONDS', 3600 );
define( 'DAY_IN_SECONDS', 86400 );
$GLOBALS['__opts']       = array();
$GLOBALS['__transients'] = array();
$GLOBALS['__home']       = 'https://example.test';
function add_action() {}
function add_filter() {}
function register_activation_hook() {}
function register_deactivation_hook() {}
function plugin_basename( $f ) { return basename( $f ); }
function __( $s ) { return $s; }
function get_option( $k, $d = false ) { return array_key_exists( $k, $GLOBALS['__opts'] ) ? $GLOBALS['__opts'][ $k ] : $d; }
function update_option( $k, $v ) { $GLOBALS['__opts'][ $k ] = $v; return true; }
function wp_parse_args( $a, $d ) { return array_merge( $d, $a ); }
function wp_parse_url( $u, $c = -1 ) { return parse_url( $u, $c ); }
function is_email( $e ) { return false !== filter_var( $e, FILTER_VALIDATE_EMAIL ) ? $e : false; }
function wp_unslash( $v ) { return $v; }
function sanitize_text_field( $v ) { return trim( strip_tags( (string) $v ) ); }
function wp_salt() { return 'test-salt'; }
function home_url() { return $GLOBALS['__home']; }
function untrailingslashit( $s ) { return rtrim( $s, '/\\' ); }
function esc_url_raw( $u ) { return $u; }
function wp_json_encode( $v ) { return json_encode( $v, JSON_UNESCAPED_SLASHES ); }
function get_transient( $k ) { $t = isset( $GLOBALS['__transients'][ $k ] ) ? $GLOBALS['__transients'][ $k ] : null; return ( $t && $t[1] > time() ) ? $t[0] : false; }
function set_transient( $k, $v, $ttl ) { $GLOBALS['__transients'][ $k ] = array( $v, time() + (int) $ttl ); return true; }
class WP_Error { public $code; public $message; public $data; function __construct( $c, $m, $d = array() ) { $this->code = $c; $this->message = $m; $this->data = $d; } }
class WP_HTTP_Response { public $data; public $status; public $headers; function __construct( $d = null, $s = 200, $h = array() ) { $this->data = $d; $this->status = $s; $this->headers = $h; } function get_status() { return $this->status; } function get_data() { return $this->data; } }
class WP_REST_Response extends WP_HTTP_Response {}
class WP_REST_Request {
	private $m; private $h; private $b; private $p;
	function __construct( $m, $h, $b, $p = array() ) { $this->m = $m; $this->b = $b; $this->p = $p; $this->h = array(); foreach ( $h as $k => $v ) { $this->h[ str_replace( '-', '_', strtolower( $k ) ) ] = $v; } }
	function get_header( $k ) { $k = str_replace( '-', '_', strtolower( $k ) ); return isset( $this->h[ $k ] ) ? $this->h[ $k ] : null; }
	function get_method() { return $this->m; }
	function get_body() { return $this->b; }
	function get_param( $k ) { return isset( $this->p[ $k ] ) ? $this->p[ $k ] : null; }
}
class Fake_WPDB {
	public $prefix = 'wp_'; public $rows = array();
	function prepare( $sql, ...$args ) { return array( $sql, $args ); }
	function get_var( $q ) { if ( is_array( $q ) && false !== strpos( $q[0], 'WHERE eid' ) ) { foreach ( $this->rows as $r ) { if ( $r['eid'] === $q[1][0] ) { return 1; } } return null; } return count( $this->rows ); }
	function insert( $t, $row ) { $this->rows[] = $row; return 1; }
}
$GLOBALS['wpdb'] = new Fake_WPDB();
require dirname( __DIR__ ) . '/whalyom/whalyom.php';

$job = json_decode( stream_get_contents( STDIN ), true );
$out = array();
if ( 'normalize' === $job['op'] ) {
	foreach ( $job['events'] as $ev ) {
		$r = Whalyom_Plugin::normalize_event( $ev );
		if ( isset( $r['event'] ) ) {
			unset( $r['event']['at'] );
		}
		$out[] = $r;
	}
} elseif ( 'signature' === $job['op'] ) {
	$GLOBALS['__opts']['whalyom_settings'] = array( 'secret' => $job['secret'] );
	foreach ( $job['cases'] as $c ) {
		$_SERVER['REQUEST_URI'] = $c['uri'];
		$_SERVER['REMOTE_ADDR'] = '203.0.113.9';
		$r                      = Whalyom_Plugin::check_signature( new WP_REST_Request( $c['method'], $c['headers'], $c['body'] ) );
		$out[]                  = true === $r ? 'ok' : $r->message;
	}
} elseif ( 'collect' === $job['op'] ) {
	$GLOBALS['__home'] = $job['home'];
	foreach ( $job['requests'] as $i => $c ) {
		$_SERVER['REMOTE_ADDR'] = isset( $c['ip'] ) ? $c['ip'] : '198.51.100.' . ( $i % 250 );
		$r                      = Whalyom_Plugin::rest_collect( new WP_REST_Request( 'POST', array( 'origin' => isset( $c['origin'] ) ? $c['origin'] : '' ), $c['body'] ) );
		$out[]                  = $r->get_status();
	}
	$out = array( 'statuses' => $out, 'stored' => count( $GLOBALS['wpdb']->rows ) );
} elseif ( 'boosters' === $job['op'] ) {
	$out = Whalyom_Plugin::sanitize_boosters( $job['items'] );
}
echo json_encode( $out, JSON_UNESCAPED_SLASHES );
