import type { SlideChart } from '@yitom/contracts'

const palette = ['#2563eb', '#ea580c', '#16a34a', '#9333ea', '#dc2626', '#0891b2']
export function PresentationChart({ chart }: { chart: SlideChart }) {
  if (!chart.editable) return <div className="flex h-full items-center justify-center border p-2 text-center text-xs text-gray-500">{chart.title || '图表'}：{chart.unsupported.join('；')}</div>
  const width = 700; const height = 400; const left = 70; const top = 45; const right = chart.legendVisible ? 150 : 25; const bottom = 60
  const plotW = width - left - right; const plotH = height - top - bottom
  const values = chart.series.flatMap((series) => series.values)
  const min = Math.min(0, ...values); const max = Math.max(1, ...values); const range = max - min || 1
  const y = (value: number): number => top + plotH - (value - min) / range * plotH
  const x = (value: number): number => left + (value - min) / range * plotW
  const zero = y(0); const zeroX = x(0)
  const label = (value: string): string => value.length > 12 ? `${value.slice(0, 11)}…` : value
  const total = chart.series[0]?.values.reduce((sum, value) => sum + value, 0) ?? 0
  let angle = -Math.PI / 2
  return <svg data-ppt-chart viewBox={`0 0 ${width} ${height}`} className="h-full w-full" role="img" aria-label={chart.title || '幻灯片图表'}>
    <title>{chart.title || '图表'}；{chart.series.map((series) => `${series.name}: ${series.values.join(', ')}`).join('；')}</title>
    <text x={width / 2} y={25} textAnchor="middle" fontSize={18} fill="#1e293b">{chart.title}</text>
    {chart.type !== 'pie' && <>
      {[0, 1, 2, 3, 4].map((tick) => {
        const value = min + range * tick / 4
        return chart.direction === 'bar' && chart.type === 'bar' ? <g key={tick}><line x1={x(value)} x2={x(value)} y1={top} y2={top + plotH} stroke="#e2e8f0" /><text x={x(value)} y={top + plotH + 22} textAnchor="middle" fontSize={12} fill="#475569">{Number(value.toPrecision(3))}</text></g>
          : <g key={tick}><line x1={left} x2={left + plotW} y1={y(value)} y2={y(value)} stroke="#e2e8f0" /><text x={left - 8} y={y(value) + 4} textAnchor="end" fontSize={12} fill="#475569">{Number(value.toPrecision(3))}</text></g>
      })}
      {chart.categories.map((category, i) => chart.direction === 'bar' && chart.type === 'bar' ? <text key={i} x={left - 8} y={top + (i + 0.5) / chart.categories.length * plotH + 4} textAnchor="end" fontSize={12} fill="#475569">{label(category)}</text>
        : <text key={i} x={left + (i + 0.5) / chart.categories.length * plotW} y={top + plotH + 22} textAnchor="middle" fontSize={12} fill="#475569">{label(category)}</text>)}
    </>}
    {chart.type === 'bar' && chart.series.map((series, s) => series.values.map((value, i) => {
      const band = (chart.direction === 'bar' ? plotH : plotW) / chart.categories.length; const thickness = band * 0.75 / chart.series.length
      return chart.direction === 'bar' ? <rect key={`${s}:${i}`} data-chart-series={series.id} data-chart-index={i} x={Math.min(zeroX, x(value))} y={top + i * band + band * 0.125 + s * thickness} width={Math.abs(x(value) - zeroX)} height={thickness} fill={series.color}><title>{categoryValue(chart, s, i)}</title></rect>
        : <rect key={`${s}:${i}`} data-chart-series={series.id} data-chart-index={i} x={left + i * band + band * 0.125 + s * thickness} y={Math.min(zero, y(value))} width={thickness} height={Math.abs(y(value) - zero)} fill={series.color}><title>{categoryValue(chart, s, i)}</title></rect>
    }))}
    {chart.type === 'line' && chart.series.map((series) => <g key={series.id} data-chart-series={series.id}>
      <polyline fill="none" stroke={series.color} strokeWidth={3} points={series.values.map((value, i) => `${left + (i + 0.5) / chart.categories.length * plotW},${y(value)}`).join(' ')} />
      {series.values.map((value, i) => <circle key={i} cx={left + (i + 0.5) / chart.categories.length * plotW} cy={y(value)} r={4} fill={series.color}><title>{chart.categories[i]}: {value}</title></circle>)}
    </g>)}
    {chart.type === 'pie' && chart.series[0].values.map((value, i) => {
      const from = angle; const size = total ? value / total * Math.PI * 2 : 0; angle += size
      const cx = left + plotW / 2; const cy = top + plotH / 2; const radius = Math.min(plotW, plotH) / 2
      return size >= Math.PI * 2 - 1e-6 ? <circle key={i} cx={cx} cy={cy} r={radius} fill={chart.series[0].color}><title>{chart.categories[i]}: {value}</title></circle>
        : <path key={i} data-chart-index={i} d={size ? `M ${cx} ${cy} L ${cx + radius * Math.cos(from)} ${cy + radius * Math.sin(from)} A ${radius} ${radius} 0 ${size > Math.PI ? 1 : 0} 1 ${cx + radius * Math.cos(angle)} ${cy + radius * Math.sin(angle)} Z` : ''} fill={i === 0 ? chart.series[0].color : palette[i % palette.length]}><title>{chart.categories[i]}: {value}</title></path>
    })}
    {chart.legendVisible && (chart.type === 'pie' ? chart.categories.map((name, i) => ({ name, color: i === 0 ? chart.series[0].color : palette[i % palette.length] })) : chart.series).map((series, i) => <g key={i} transform={`translate(${width - right + 20},${top + 24 * i})`}><rect width={12} height={12} fill={series.color} /><text x={20} y={11} fontSize={12} fill="#475569">{label(series.name)}</text></g>)}
  </svg>
}
function categoryValue(chart: SlideChart, series: number, category: number): string { return `${chart.series[series].name} / ${chart.categories[category]}: ${chart.series[series].values[category]}` }
