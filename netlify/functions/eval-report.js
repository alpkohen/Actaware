const { createClient } = require('@supabase/supabase-js');

exports.handler = async function () {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { data, error } = await supabase
    .from('eval_results')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    return { statusCode: 500, body: `Supabase error: ${error.message}` };
  }

  const rows = data || [];

  const tableRows = rows.map(r => {
    const s = r.scores || {};
    const acc = s.accuracy_score ?? '-';
    const com = s.completeness_score ?? '-';
    const act = s.actionability_score ?? '-';
    const cla = s.clarity_score ?? '-';
    const avg = (typeof acc === 'number' && typeof com === 'number' && typeof act === 'number' && typeof cla === 'number')
      ? ((acc + com + act + cla) / 4).toFixed(1)
      : '-';
    const avgNum = parseFloat(avg);
    const color = avgNum >= 4.5 ? '#22c55e' : avgNum >= 3.5 ? '#f59e0b' : avgNum >= 1 ? '#ef4444' : '#94a3b8';
    const date = new Date(r.created_at).toLocaleString('en-GB');
    const preview = (r.claude_output || '').slice(0, 150).replace(/</g, '&lt;').replace(/\*\*/g, '');
    const rationale = (r.scores || {}).brief_rationale || '';
    const flag = r.judge_error ? ' HATA' : '';
    return `<tr>
      <td style="white-space:nowrap">${date}</td>
      <td><strong>${r.case_id}</strong></td>
      <td>${r.source || '-'}</td>
      <td style="text-align:center">${acc}</td>
      <td style="text-align:center">${com}</td>
      <td style="text-align:center">${act}</td>
      <td style="text-align:center">${cla}</td>
      <td style="text-align:center;font-weight:700;color:${color}">${avg}${flag}</td>
      <td style="font-size:12px;color:#94a3b8">${preview}...</td>
      <td style="font-size:11px;color:#64748b">${rationale}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ActAware - AI Quality Report</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 24px; }
  h1 { color: #f8fafc; font-size: 22px; margin-bottom: 4px; }
  p.sub { color: #94a3b8; font-size: 14px; margin-bottom: 24px; }
  .wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { background: #1e293b; color: #94a3b8; text-align: left; padding: 10px 12px; font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: .05em; }
  td { padding: 10px 12px; border-bottom: 1px solid #1e293b; vertical-align: top; }
  tr:hover td { background: #1e293b55; }
</style>
</head>
<body>
<h1>ActAware - AI Quality Report</h1>
<p class="sub">Son ${rows.length} eval sonucu &middot; Skorlar 1-5 arasi (5 = mukemmel) &middot; Yesil &ge;4.5 / Sari &ge;3.5 / Kirmizi &lt;3.5</p>
<div class="wrap">
<table>
<thead><tr>
  <th>Tarih</th><th>Case</th><th>Kaynak</th>
  <th>Accuracy</th><th>Complete</th><th>Action</th><th>Clarity</th>
  <th>Ortalama</th><th>Claude Cikti (onizleme)</th><th>Judge Yorumu</th>
</tr></thead>
<tbody>${tableRows}</tbody>
</table>
</div>
</body>
</html>`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: html,
  };
};
