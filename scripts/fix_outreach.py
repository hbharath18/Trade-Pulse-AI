import sys

with open('server/outreach.js', 'r', encoding='utf-8') as f:
    code = f.read()

# Replace lines 128-133 (the broken OpenAI /v1/responses block)
# Use line-based replacement since exact string doesn't match due to encoding
lines = code.split('\n')

start = None
end = None
for i, line in enumerate(lines):
    if "api.openai.com/v1/responses" in line:
        start = i
    if start and "AI draft only" in line:
        end = i
        break

if start is None or end is None:
    print(f"ERROR: Block not found (start={start}, end={end})")
    sys.exit(1)

print(f"Found block at lines {start+1} to {end+1}")

new_lines = [
    "   const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';",
    "   let resAi;",
    "   try {",
    "     resAi = await fetch('https://api.openai.com/v1/chat/completions', {",
    "       method: 'POST',",
    "       headers: { 'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY, 'Content-Type': 'application/json' },",
    "       body: JSON.stringify({",
    "         model,",
    '         messages: [',
    '           { role: \'system\', content: \'You produce truthful, low-pressure commercial buyer outreach drafts. Output valid JSON only with keys "subject" and "body".\' },',
    '           { role: \'user\', content: prompt }',
    '         ],',
    '         response_format: { type: \'json_object\' }',
    '       })',
    '     });',
    '   } catch (networkErr) {',
    "     throw Object.assign(Error('Network error connecting to OpenAI: ' + networkErr.message), {status: 502});",
    '   }',
    '   if (!resAi.ok) {',
    '     const errBody = await resAi.json().catch(() => ({}));',
    "     const errMsg = errBody?.error?.message || ('OpenAI returned status ' + resAi.status);",
    "     return res.status(502).json({ error: 'OpenAI error: ' + errMsg });",
    '   }',
    '   const jsonRes = await resAi.json();',
    "   const rawOutput = jsonRes.choices?.[0]?.message?.content || '';",
    '   const cleanOutput = rawOutput.replace(/^```json\\s*/i, \'\').replace(/```\\s*$/i, \'\').trim();',
    '   const match = cleanOutput.match(/\\{[\\s\\S]*\\}/);',
    "   if (!match) throw Error('OpenAI returned a non-JSON response. Use the template draft or try again.');",
    '   const draft = JSON.parse(match[0]);',
    "   if (typeof draft.subject !== 'string' || typeof draft.body !== 'string' || !draft.subject.trim() || !draft.body.trim()) {",
    "     throw Error('OpenAI draft missing valid subject or body');",
    '   }',
    "   res.json({ subject: draft.subject.slice(0, 200), body: draft.body.slice(0, 4000), note: 'AI draft generated. Read and verify carefully before approval.' });"
]

lines[start:end+1] = new_lines
code = '\n'.join(lines)

with open('server/outreach.js', 'w', encoding='utf-8') as f:
    f.write(code)
print('SUCCESS: outreach.js AI draft block replaced')
