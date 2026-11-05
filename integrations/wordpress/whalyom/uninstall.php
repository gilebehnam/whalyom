<?php
/**
 * Removes everything the Whalyom plugin stored: settings, the events table and transients.
 *
 * @package Whalyom
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

/**
 * Cleans one site.
 */
function whalyom_uninstall_site() {
	global $wpdb;
	delete_option( 'whalyom_settings' );
	delete_option( 'whalyom_db_version' );
	delete_option( 'whalyom_boosters' );
	wp_clear_scheduled_hook( 'whalyom_prune' );
	$table = esc_sql( $wpdb->prefix . 'whalyom_events' );
	// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.DirectDatabaseQuery.SchemaChange, WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- dropping the plugin's own table.
	$wpdb->query( "DROP TABLE IF EXISTS `{$table}`" );
	// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- transients of this plugin only.
	$wpdb->query( $wpdb->prepare( "DELETE FROM {$wpdb->options} WHERE option_name LIKE %s OR option_name LIKE %s", $wpdb->esc_like( '_transient_whalyom_' ) . '%', $wpdb->esc_like( '_transient_timeout_whalyom_' ) . '%' ) );
}

if ( is_multisite() ) {
	foreach ( get_sites( array( 'fields' => 'ids' ) ) as $whalyom_blog_id ) {
		switch_to_blog( $whalyom_blog_id );
		whalyom_uninstall_site();
		restore_current_blog();
	}
} else {
	whalyom_uninstall_site();
}
