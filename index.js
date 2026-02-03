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

import { createClient } from '@retconned/kick-js';
import 'dotenv/config';

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

  console.log(`[VOTE] ${kickUsername} voted ${choice}: ${success ? (result?.message || 'OK') : 'FAILED'}`);
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

  console.log(`[BONUS] ${kickUsername} guessed ${amount}: ${success ? (result?.message || 'OK') : 'FAILED'}`);
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
    console.log(`[LINK] ${kickUsername} link failed: ${result?.message || result?.error || 'Unknown error'}`);
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

  try {
    // Create client in read-only mode (no auth required)
    // Configure browser options for Docker/Railway environment
    const client = createClient(config.kickChannel, {
      logger: false,
      readOnly: true,
      browser: {
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--single-process',
        ],
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
