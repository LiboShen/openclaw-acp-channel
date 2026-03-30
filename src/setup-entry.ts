/**
 * Setup Entry Point
 * 
 * Lightweight entry point for setup flows (when plugin is disabled/unconfigured).
 * OpenClaw loads this instead of the full plugin to avoid pulling in heavy runtime code.
 */

// @ts-ignore - This import works inside OpenClaw
import { defineSetupPluginEntry } from 'openclaw/plugin-sdk/core';
import { acpChannelPlugin } from './channel.js';

/**
 * Export minimal plugin interface for setup
 * defineSetupPluginEntry wraps the channel plugin for setup-time usage
 */
export default defineSetupPluginEntry(acpChannelPlugin);
