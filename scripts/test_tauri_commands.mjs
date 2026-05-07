#!/usr/bin/env node
// Test script to verify Tauri commands work correctly

async function main() {
  const { invoke } = await import('@tauri-apps/api/core');

  console.log('=== Tauri Command Test ===\n');

  // Test 1: Get API keys
  console.log('[1] cmd_get_api_keys...');
  try {
    const keys = await invoke('cmd_get_api_keys');
    console.log(`    Found ${keys.length} key(s)`);
    if (keys.length > 0) {
      const k = keys[0];
      console.log(`    Key[0]: id=${k.id}, name=${k.name}, color=${k.color}, refresh=${k.refresh_interval}s`);
    }
  } catch (e) {
    console.log(`    Error: ${e}`);
  }

  // Test 2: Get config
  console.log('\n[2] cmd_get_config...');
  try {
    const config = await invoke('cmd_get_config');
    console.log(`    config_version=${config.config_version}, api_keys=${config.api_keys.length}`);
  } catch (e) {
    console.log(`    Error: ${e}`);
  }

  // Test 3: Get all usage data
  console.log('\n[3] cmd_get_all_usage_data...');
  try {
    const usage = await invoke('cmd_get_all_usage_data');
    const keys = Object.keys(usage);
    console.log(`    Got ${keys.length} usage record(s): ${keys.join(', ')}`);
  } catch (e) {
    console.log(`    Error: ${e}`);
  }

  // Test 4: Test cmd_update_api_key with correct parameters
  const keys = await invoke('cmd_get_api_keys');
  if (keys.length > 0) {
    const k = keys[0];
    console.log(`\n[4] cmd_update_api_key (id=${k.id})...`);
    try {
      // Pass api_key=null to test that it doesn't fail with Option<String>
      await invoke('cmd_update_api_key', {
        id: k.id,
        name: k.name,
        color: k.color,
        refreshInterval: k.refresh_interval,  // snake_case for Rust
        apiKey: null  // null = don't change the key
      });
      console.log('    PASS: cmd_update_api_key succeeded');
    } catch (e) {
      console.log(`    FAIL: ${e}`);
      process.exit(1);
    }
  } else {
    console.log('\n[4] SKIP: No keys to test update');
  }

  console.log('\n=== All tests passed ===');
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});