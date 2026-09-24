import http from 'node:http';

const options = Object.fromEntries(process.argv.slice(2).map((argument) => argument.replace(/^--/, '').split('=')));
const port = Number(options.port ?? 8787);
const delay = Number(options.delay ?? 150);
const mode = options.mode ?? 'normal';
if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isFinite(delay) || delay < 0 ||
    !['normal', 'malformed', 'http-error'].includes(mode)) {
  throw new Error('Use --port=8787 --delay=150 --mode=normal|malformed|http-error');
}

function send(response, status, payload) {
  if (!response.destroyed) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(payload));
  }
}

function fixtureIssues(payload) {
  const { reviewRange, lines } = payload;
  if (!reviewRange || !Array.isArray(lines)) throw new Error('Missing reviewRange or lines.');
  const issues = [];
  for (const line of lines) {
    if (line.index < reviewRange.startInclusive || line.index >= reviewRange.endExclusive) continue;
    if (line.source === '最后一班车已经走了。' && line.translation === "The last train hasn't left yet.") {
      issues.push({
        index: line.index,
        proposed: 'The last train has already left.',
        reason: '原文说明末班车已经离开，译文却说尚未离开，否定关系相反。',
        evidence: `第 ${line.index + 1} 条：“已经走了”。`,
      });
    }
    if (line.source === '她把伞递给了林，自己却退回屋檐下。' && line.translation.startsWith('He handed Lin')) {
      issues.push({
        index: line.index,
        proposed: line.translation.replace(/^He /, 'She '),
        reason: '原文使用“她”，译文使用 He，人物代词有误。',
        evidence: `第 ${line.index + 1} 条中文原文明示女性代词。`,
      });
    }
  }
  return issues.reverse(); // Exercise index-based merging instead of response-order merging.
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    send(response, 200, { status: 'ok', mode, delay });
    return;
  }
  if (request.method === 'GET' && ['/models', '/v1/models'].includes(request.url)) {
    send(response, 200, { object: 'list', data: [{ id: 'fixture-model' }, { id: 'fixture-model-jp' }, { id: 'fixture-model-fast' }] });
    return;
  }
  if (request.method !== 'POST' || !['/chat/completions', '/v1/chat/completions'].includes(request.url)) {
    send(response, 404, { error: { message: 'Use POST /v1/chat/completions.' } });
    return;
  }

  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) throw new Error('Request too large.');
      chunks.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const userMessage = body.messages?.findLast((message) => message.role === 'user')?.content;
    if (typeof userMessage !== 'string') throw new Error('Missing user message.');
    await new Promise((resolve) => setTimeout(resolve, delay));
    if (mode === 'http-error') {
      send(response, 503, { error: { message: 'Intentional local mock failure.' } });
      return;
    }

    let content = 'OK';
    if (userMessage !== 'Reply with OK.') {
      content = mode === 'malformed'
        ? 'This intentionally is not JSON.'
        : JSON.stringify({ issues: fixtureIssues(JSON.parse(userMessage)) });
    }
    send(response, 200, {
      id: 'local-fixture-response',
      object: 'chat.completion',
      model: body.model ?? 'fixture-model',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    });
  } catch (error) {
    send(response, 400, { error: { message: error instanceof Error ? error.message : 'Bad request.' } });
  }
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Local fixture server: http://127.0.0.1:${port}/v1 (${mode}, ${delay} ms)\n`);
});
