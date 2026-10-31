'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatAmount } from '@/lib/format'
import type { CategoryTotal, TrendPoint } from '@/services/report-service'

// Charts adapt to light/dark through currentColor: the wrapper sets the text
// colour and every stroke, tick and bar inherits it.
const axisProps = {
  tick: { fill: 'currentColor', fontSize: 12 },
  tickLine: false,
} as const

const tooltipStyle = {
  borderRadius: 6,
  fontSize: 12,
  borderColor: 'rgb(212 212 212)',
} as const

const chartWrapperClass = 'h-64 w-full text-neutral-700 dark:text-neutral-200'

// Monthly approved spending for the last 6 months (Phase 4 output d).
export function TrendChart({
  points,
  currency,
}: {
  points: TrendPoint[]
  currency: string
}) {
  return (
    <div className={chartWrapperClass}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={points}
          margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
        >
          <CartesianGrid
            stroke="currentColor"
            strokeOpacity={0.15}
            vertical={false}
          />
          <XAxis
            dataKey="month"
            {...axisProps}
            axisLine={{ stroke: 'currentColor', strokeOpacity: 0.3 }}
          />
          <YAxis
            {...axisProps}
            axisLine={false}
            width={56}
            tickFormatter={(value: number) => formatAmount(value, currency)}
          />
          <Tooltip
            formatter={(value) => [
              formatAmount(Number(value), currency),
              'Approved',
            ]}
            contentStyle={tooltipStyle}
          />
          <Line
            type="monotone"
            dataKey="total"
            stroke="currentColor"
            strokeWidth={2}
            dot={{ r: 3, fill: 'currentColor' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// Approved spending by category for the chosen month (Phase 4 output d).
export function CategoryChart({
  data,
  currency,
}: {
  data: CategoryTotal[]
  currency: string
}) {
  return (
    <div className={chartWrapperClass}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
        >
          <CartesianGrid
            stroke="currentColor"
            strokeOpacity={0.15}
            vertical={false}
          />
          <XAxis dataKey="category" {...axisProps} axisLine={false} />
          <YAxis
            {...axisProps}
            axisLine={false}
            width={56}
            tickFormatter={(value: number) => formatAmount(value, currency)}
          />
          <Tooltip
            formatter={(value) => [
              formatAmount(Number(value), currency),
              'Approved',
            ]}
            contentStyle={tooltipStyle}
          />
          <Bar dataKey="total" fill="currentColor" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
