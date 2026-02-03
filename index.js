/**
 * Slot League - Kick Chat Bridge
 * 
 * Connects to a Kick channel's chat and forwards voting commands to your webhooks.
 * No Kick authentication required - reads public chat only.
 * 
 * SETUP:
 * 1. Copy .env.example to .env and fill in your values
 * 2. npm install
 * 3. npm start
 * 
 * COMMANDS RECOGNIZED:
 * - !vote 1 / !1       → Vote for Game 1
 * - !vote 2 / !2       → Vote for Game 2
 * - !guess <amount>    → Bonus round guess
 * - !link <code>       → Link Kick account to web profile
 */

// CRITICAL: Set Puppeteer env vars BEFORE any imports
// This tells Puppeteer to use system Chromium instead of downloading its own
process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD = 'true';
// Newer Puppeteer versions use this flag name
process.env.PUPPETEER_SKIP_DOWNLOAD = 'true';
process.env.PUPPETEER_EXECUTABLE_PATH = '/usr/bin/chromium-browser';
// Ensure Puppeteer doesn't look in an unwritable/non-persistent location
process.env.PUPPETEER_CACHE_DIR = process.env.PUPPETEER_CACHE_DIR || '/tmp/puppeteer';

// Crash diagnostics (Railway may only show "Crashed" unless we log the reason)
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection:', reason);
  process.exit(1);
});

process.on('exit', (code) => {
  console.log(`[EXIT] process exiting with code ${code}`);
});

import { createClient } from '@retconned/kick-js';
import 'dotenv/config';
import fs from 'node:fs';

// ============================================================================
// Configuration
// ============================================================================

const config = {
  kickChannel: process.env.KICK_CHANNEL || 'dylangg',
  webhookSecret: process.env.WEBHOOK_SECRET,
  supabaseUrl: process.env.SUPABASE_URL || 'https://idpcknsxscpqquguuffi.supabase.co',
};

if (!config.webhookSecret) {
  console.error('❌ ERROR: WEBHOOK_SECRET is required in .env');
  process.exit(1);
}

// ============================================================================
// Active State (controlled via admin commands or external API)
// ============================================================================

let activeMatchId = null;
let activeBonusRoundId = null;

// ============================================================================
// Command Patterns
// ============================================================================

const VOTE_PATTERN = /^!(?:vote\s*)?([12])$/i;
const GUESS_PATTERN = /^!guess\s+(\d+(?:\.\d+)?)$/i;
const LINK_PATTERN = /^!link\s+([A-Z0-9]{6})$/i;

// Admin commands (restrict to specific users if needed)
const SET_MATCH_PATTERN = /^!setmatch\s+(.+)$/i;
const SET_BONUS_PATTERN = /^!setbonus\s+(.+)$/i;

// ============================================================================
// Webhook Handlers
// ============================================================================

async function sendWebhook(endpoint, payload) {
  try {
    const response = await fetch(
      `${config.supabaseUrl}/functions/v1/${endpoint}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Secret': config.webhookSecret,
        },
        body: JSON.stringify(payload),
      }
    );

    const result = await response.json();
    return { success: response.ok, result };
  } catch (error) {
    console.error(`[WEBHOOK] Error calling ${endpoint}:`, error.message);
    return { success: false, error: error.message };
  }
}

async function handleVote(kickUserId, kickUsername, choice) {
  if (!activeMatchId) {
    console.log(`[VOTE] No active match, ignoring vote from ${kickUsername}`);
    return;
  }

  const { success, result } = await sendWebhook('vote-webhook', {
    match_id: activeMatchId,
    kick_user_id: kickUserId,
    kick_username: kickUsername,
    choice: parseInt(choice),
    timestamp: new Date().toISOString(),
  });

  console.log(
    `[VOTE] ${kickUsername} voted ${choice}: ${
      success ? (result?.message || 'OK') : 'FAILED'
    }`
  );
}

async function handleBonusGuess(kickUserId, kickUsername, amount) {
  if (!activeBonusRoundId) {
    console.log(`[BONUS] No active bonus round, ignoring guess from ${kickUsername}`);
    return;
  }

  const { success, result } = await sendWebhook('bonus-guess-webhook', {
    bonus_round_id: activeBonusRoundId,
    kick_user_id: kickUserId,
    kick_username: kickUsername,
    guess_amount: parseFloat(amount),
    timestamp: new Date().toISOString(),
  });

  console.log(
    `[BONUS] ${kickUsername} guessed ${amount}: ${
      success ? (result?.message || 'OK') : 'FAILED'
    }`
  );
}

async function handleAccountLink(kickUserId, kickUsername, code) {
  const { success, result } = await sendWebhook('link-kick-account', {
    kick_user_id: kickUserId,
    kick_username: kickUsername,
    code: code.toUpperCase(),
    timestamp: new Date().toISOString(),
  });

  if (success) {
    console.log(`[LINK] ${kickUsername} linked successfully: ${result?.message}`);
  } else {
    console.log(
      `[LINK] ${kickUsername} link failed: ${result?.message || result?.error || 'Unknown error'}`
    );
  }
}

// ============================================================================
// Message Processor
// ============================================================================

function processMessage(message) {
  const text = message.content?.trim();
  if (!text) return;

  const sender = message.sender;
  const kickUserId = String(sender.id);
  const kickUsername = sender.username;

  // Vote command
  const voteMatch = text.match(VOTE_PATTERN);
  if (voteMatch) {
    handleVote(kickUserId, kickUsername, voteMatch[1]);
    return;
  }

  // Bonus guess command
  const guessMatch = text.match(GUESS_PATTERN);
  if (guessMatch) {
    handleBonusGuess(kickUserId, kickUsername, guessMatch[1]);
    return;
  }

  // Account link command
  const linkMatch = text.match(LINK_PATTERN);
  if (linkMatch) {
    handleAccountLink(kickUserId, kickUsername, linkMatch[1]);
    return;
  }

  // Admin: Set active match
  const setMatchMatch = text.match(SET_MATCH_PATTERN);
  if (setMatchMatch) {
    activeMatchId = setMatchMatch[1].trim();
    console.log(`[ADMIN] Active match set to: ${activeMatchId}`);
    return;
  }

  // Admin: Set active bonus round
  const setBonusMatch = text.match(SET_BONUS_PATTERN);
  if (setBonusMatch) {
    activeBonusRoundId = setBonusMatch[1].trim();
    console.log(`[ADMIN] Active bonus round set to: ${activeBonusRoundId}`);
    return;
  }

  // Admin: Clear match
  if (text === '!clearmatch') {
    activeMatchId = null;
    console.log(`[ADMIN] Active match cleared`);
    return;
  }

  // Admin: Clear bonus
  if (text === '!clearbonus') {
    activeBonusRoundId = null;
    console.log(`[ADMIN] Active bonus round cleared`);
    return;
  }
}

// ============================================================================
// Main - Connect to Kick Chat
// ============================================================================

async function main() {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           Slot League - Kick Chat Bridge                   ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Channel:     ${config.kickChannel}`);
  console.log(`  Webhook URL: ${config.supabaseUrl}`);
  console.log('');
  console.log('  Commands:');
  console.log('    !vote 1 / !1      Vote for Game 1');
  console.log('    !vote 2 / !2      Vote for Game 2');
  console.log('    !guess <amount>   Bonus round guess');
  console.log('    !link <CODE>      Link Kick to web account');
  console.log('');
  console.log('  Admin:');
  console.log('    !setmatch <id>    Set active match UUID');
  console.log('    !setbonus <id>    Set active bonus round UUID');
  console.log('    !clearmatch       Clear active match');
  console.log('    !clearbonus       Clear active bonus round');
  console.log('');
  console.log('════════════════════════════════════════════════════════════════');
  console.log('');

  // Heartbeat so we can tell if the process stays alive vs. dying silently
  const startedAt = Date.now();
  const heartbeat = setInterval(() => {
    const uptimeSec = Math.round((Date.now() - startedAt) / 1000);
    console.log(`[HEARTBEAT] uptime=${uptimeSec}s`);
  }, 30_000);
  heartbeat.unref?.();

  // Runtime diagnostics (helps confirm whether Railway is honoring Dockerfile USER)
  try {
    const uid = typeof process.getuid === 'function' ? process.getuid() : 'n/a';
    const gid = typeof process.getgid === 'function' ? process.getgid() : 'n/a';
    console.log(`  Runtime UID: ${uid}  GID: ${gid}`);
    console.log(`  Node Env:    ${process.env.NODE_ENV || 'undefined'}`);
  } catch {
    // ignore
  }

  try {
    // Resolve the actual system Chromium path (Alpine images may use /usr/bin/chromium)
    const candidatePaths = [
      process.env.PUPPETEER_EXECUTABLE_PATH,
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
    ].filter(Boolean);

    const chromiumPath = candidatePaths.find((p) => {
      try {
        return fs.existsSync(p);
      } catch {
        return false;
      }
    });

    if (!chromiumPath) {
      console.error(`❌ Could not find system Chromium. Tried: ${candidatePaths.join(', ')}`);
    } else {
      // Keep env var aligned with what we actually found
      process.env.PUPPETEER_EXECUTABLE_PATH = chromiumPath;
      console.log(`  Chromium:    ${chromiumPath}`);
    }

    const launchArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote',
      '--single-process',
    ];

    console.log(`  Launch args: ${launchArgs.join(' ')}`);

    // Create client in read-only mode (no auth required)
    const client = createClient(config.kickChannel, {
      logger: false,
      readOnly: true,
      // Some versions of kick-js forward these options to puppeteer.launch.
      // Supplying multiple common keys increases compatibility across versions.
      puppeteer: {
        executablePath: chromiumPath,
        args: launchArgs,
      },
      browser: {
        executablePath: chromiumPath,
        args: launchArgs,
      },
      launchOptions: {
        executablePath: chromiumPath,
        args: launchArgs,
      },
    });

    client.on('ready', () => {
      console.log(`✅ Connected to ${config.kickChannel}'s chat!`);
      console.log('   Listening for commands...');
      console.log('');
    });

    client.on('ChatMessage', (message) => {
      processMessage(message);
    });

    client.on('error', (error) => {
      console.error('❌ Connection error:', error.message);
    });

    client.on('disconnect', () => {
      console.log('⚠️  Disconnected from chat. Attempting to reconnect...');
    });

    // Keep the process running
    process.on('SIGINT', () => {
      console.log('\n👋 Shutting down...');
      process.exit(0);
    });
  } catch (error) {
    console.error('❌ Failed to connect:', error.message);
    process.exit(1);
  }
}

main();

// ============================================================================
// Export for programmatic use
// ============================================================================

export function setActiveMatch(id) {
  activeMatchId = id;
  console.log(`[API] Active match set to: ${id}`);
}

export function setActiveBonusRound(id) {
  activeBonusRoundId = id;
  console.log(`[API] Active bonus round set to: ${id}`);
}

export function getActiveState() {
  return { activeMatchId, activeBonusRoundId };
}
