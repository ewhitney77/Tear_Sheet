"use client";

import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { SegmentData, RevenuePoint } from "@/lib/types";

interface Props {
  segmentData: SegmentData[];
  geoData: SegmentData[];
  revenueHistory: RevenuePoint[];
}

const RADIAN = Math.PI / 180;

function renderCustomLabel({
  cx,
  cy,
  midAngle,
  innerRadius,
  outerRadius,
  percent,
  name,
}: {
  cx: number;
  cy: number;
  midAngle: number;
  innerRadius: number;
  outerRadius: number;
  percent: number;
  name: string;
}) {
  if (percent < 0.08) return null;
  const radius = innerRadius + (outerRadius - innerRadius) * 1.4;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  return (
    <text
      x={x}
      y={y}
      fill="#334e68"
      textAnchor={x > cx ? "start" : "end"}
      dominantBaseline="central"
      fontSize={8}
      fontFamily="JetBrains Mono, monospace"
    >
      {name} {(percent * 100).toFixed(0)}%
    </text>
  );
}

export default function SegmentCharts({ segmentData, geoData, revenueHistory }: Props) {
  const formatRevenue = (val: number) => {
    if (val >= 1e9) return `${(val / 1e9).toFixed(0)}`;
    if (val >= 1e6) return `${(val / 1e6).toFixed(0)}`;
    return val.toLocaleString();
  };

  return (
    <div className="w-full">
      <div className="text-[10px] font-bold text-center mb-2 bg-navy-900 text-white py-1 mx-4 rounded-sm" style={{ fontFamily: "JetBrains Mono, monospace" }}>
        Revenue by Business and Geographic Segments (USD, mm)
      </div>
      <div className="flex items-start gap-2">
        {/* Revenue bar chart */}
        <div className="flex-1" style={{ minWidth: 0 }}>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={revenueHistory} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis
                dataKey="year"
                tick={{ fontSize: 8, fill: "#627d98", fontFamily: "JetBrains Mono, monospace" }}
                axisLine={{ stroke: "#bcccdc" }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 8, fill: "#627d98", fontFamily: "JetBrains Mono, monospace" }}
                axisLine={false}
                tickLine={false}
                width={40}
                tickFormatter={formatRevenue}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#0a1929",
                  border: "1px solid #334e68",
                  borderRadius: "4px",
                  fontSize: "10px",
                  fontFamily: "JetBrains Mono, monospace",
                  color: "#fff",
                }}
                formatter={(value: number) => [`$${(value / 1e6).toFixed(0)}M`, "Revenue"]}
              />
              <Bar dataKey="revenue" fill="#0a1929" radius={[2, 2, 0, 0]}>
                {revenueHistory.map((_, i) => (
                  <Cell key={i} fill={i === revenueHistory.length - 1 ? "#0a1929" : "#627d98"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Segment pie */}
        <div style={{ width: 140 }}>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie
                data={segmentData}
                cx="50%"
                cy="50%"
                outerRadius={55}
                innerRadius={25}
                dataKey="value"
                label={renderCustomLabel}
                labelLine={false}
              >
                {segmentData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: "#0a1929",
                  border: "1px solid #334e68",
                  borderRadius: "4px",
                  fontSize: "10px",
                  color: "#fff",
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Geography pie */}
        <div style={{ width: 140 }}>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie
                data={geoData}
                cx="50%"
                cy="50%"
                outerRadius={55}
                innerRadius={25}
                dataKey="value"
                label={renderCustomLabel}
                labelLine={false}
              >
                {geoData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: "#0a1929",
                  border: "1px solid #334e68",
                  borderRadius: "4px",
                  fontSize: "10px",
                  color: "#fff",
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="text-[7px] space-y-1 pt-4 pr-2" style={{ minWidth: 80 }}>
          {geoData.map((item, i) => (
            <div key={i} className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: item.color }} />
              <span className="text-gray-600 truncate">{item.name}</span>
            </div>
          ))}
        </div>
      </div>
      <p className="text-[7px] text-gray-400 italic px-4 mt-1">
        * Segments with negative values, such as corporate eliminations, are excluded from the total and percentage calculations and do not appear on the charts
      </p>
    </div>
  );
}
