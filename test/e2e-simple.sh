#!/bin/bash
# Simple end-to-end test

set -e

echo "=== E2E Test: OpenClaw ACP Channel ==="

# Cleanup
pkill -f "tail -f /tmp/acp-test-pipe" 2>/dev/null || true
rm -f /tmp/acp-test-pipe /tmp/acp-out.txt /tmp/acp-err.txt

# Create pipe
mkfifo /tmp/acp-test-pipe

# Start bridge
echo "Starting bridge..."
(tail -f /tmp/acp-test-pipe | ACP_API_TOKEN=test-token-123 ACP_USER_ID=test-user node dist/bridge.js > /tmp/acp-out.txt 2> /tmp/acp-err.txt) &
BRIDGE_PID=$!
sleep 3

# Test 1: Simple math
echo ""
echo "Test 1: Simple question"
echo '{"role":"user","content":"What is 7+5? Just the number."}' > /tmp/acp-test-pipe
sleep 10

REPLY=$(tail -1 /tmp/acp-out.txt)
echo "Reply: $REPLY"

if echo "$REPLY" | grep -q '"role":"assistant"'; then
    echo "✅ Test 1 PASSED"
else
    echo "❌ Test 1 FAILED"
    exit 1
fi

# Test 2: Conversation memory
echo ""
echo "Test 2: Conversation memory"
echo '{"role":"user","content":"What was my previous question?"}' > /tmp/acp-test-pipe
sleep 10

REPLY2=$(tail -1 /tmp/acp-out.txt)
echo "Reply: $REPLY2"

if echo "$REPLY2" | grep -q "7+5\|7 + 5"; then
    echo "✅ Test 2 PASSED"
else
    echo "❌ Test 2 FAILED"
    exit 1
fi

# Cleanup
kill $BRIDGE_PID 2>/dev/null || true
rm -f /tmp/acp-test-pipe

echo ""
echo "=== ALL TESTS PASSED ==="
