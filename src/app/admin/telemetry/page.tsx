import Link from 'next/link';
import { getDbPool } from '@/lib/db';
import { isLocalDemo } from '@/lib/local-demo';
import { requireAtelierAdmin, withAccessBoundary } from '../access';
import { getTelemetrySummary } from '@/modules/admin/telemetry-repo';
import { Shell } from '../Shell';

export const metadata = {title:'Telemetry'};
export default async function TelemetryPage({searchParams}: {searchParams:Promise<{days?:string}>}) {
  const db = getDbPool();
  await requireAtelierAdmin(db);
  const days = (await searchParams).days === '30' ? 30 : 7;
  const data = await withAccessBoundary(() => getTelemetrySummary(db,days));
  const latency = (ms:number|null) => ms === null ? '—' : Math.round(ms).toLocaleString('en-US')+' ms';
  return <Shell section="telemetry" title="Studio telemetry">
    <nav className="admin-tabs" aria-label="Reporting period">{[7,30].map(d=>
      <Link key={d} href={'/admin/telemetry?days='+d} aria-current={d===days?'page':undefined}>Last {d} days</Link>)}</nav>
    <dl className="admin-metrics">{[
      ['Searches',data.searches],['Outbound clicks',data.clicks],['Outbound CTR',(100*data.outboundCtr).toFixed(1)+'%'],
      ['Median search latency',latency(data.p50LatencyMs)],['95th percentile latency',latency(data.p95LatencyMs)],
    ].map(([name,value])=><div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
    <div className="admin-grid"><section className="admin-panel"><h2>Maker referrals</h2>
      {data.perMakerClicks.length ? <table><thead><tr><th>Pattern house</th><th>Outbound clicks</th></tr></thead>
        <tbody>{data.perMakerClicks.map(m=><tr key={m.makerId}><td>{m.makerName}</td><td>{m.clicks}</td></tr>)}</tbody></table> :
        <p>No outbound clicks in this period.</p>}</section>
      {isLocalDemo() ? <section className="admin-panel"><h2>Today’s simulated model activity</h2>
        <p className="admin-number">{data.dailyRequests.toLocaleString()}</p>
        <p>Simulated requests · UTC · ${data.dailySpendUsd.toFixed(4)} in provider charges</p></section>
        : <section className="admin-panel"><h2>Today’s AI spend</h2>
        <p className="admin-number">${data.dailySpendUsd.toFixed(4)}</p><p>of ${data.dailyBudgetUsd.toFixed(2)} daily budget · UTC</p>
        <progress aria-label="Daily AI budget used" value={data.dailySpendUsd} max={data.dailyBudgetUsd || 1}/></section>}
    </div>
  </Shell>;
}
