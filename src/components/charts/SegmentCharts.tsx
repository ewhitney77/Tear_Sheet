"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
} from "recharts";
import { SegmentData, RevenuePoint, EBITDAPoint } from "@/lib/types";

interface Props {
  segmentData: SegmentData[];
  geoData: SegmentData[];
  revenueHistory: RevenuePoint[];
  ebitdaHistory: EBITDAPoint[];
}

const RADIAN = Math.PI / 180;

function renderCustomLabel({
  cx, cy, midAngle, innerRadius, outerRadius, percent, name,
}: {
  cx: number; cy: number; midAngle: number; innerRadius: number;
  outerRadius: number; percent: number; name: string;
}) {
  if (percent < 0.06) return null;
  const radius = innerRadius + (outerRadius - innerRadius) * 1.45;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="#334e68" textAnchor={x > cx ? "start" : "end"}
      dominantBaseline="central" fontSize={7} fontFamily="JetBrains Mono, monospace">
      {name.length > 12 ? name.substring(0, 10) + ".." : name} {(percent * 100).toFixed(0)}%
    </text>
  );
}

export default function SegmentCharts({ segmentData = [], geoData = [], revenueHistory = [], ebitdaHistory = [] }: Props) {
  const formatRevenue = (val: number) => {
    if (Math.abs(val) >= 1e9) return `$${(val / 1e9).toFixed(1)}B`;
    if (Math.abs(val) >= 1e6) return `$${(val / 1e6).toFixed(0)}M`;
    return `$${val.toLocaleString()}`;
  };

  const formatAxis = (val: number) => {
    if (Math.abs(val) >= 1e9) return `${(val / 1e9).toFixed(0)}B`;
    if (Math.abs(val) >= 1e6) return `${(val / 1e6).toFixed(0)}M`;
    return val.toLocaleString();
  };

  return (
    <div className="w-full">
      <div className="text-[10px] font-bold text-center mb-3 bg-navy-900 text-white py-1 mx-4 rounded-sm"
        style={{ fontFamily: "JetBrains Mono, monospace" }}>
        Revenue &amp; EBITDA Trends / Segment Breakdown (USD)
      </div>

      {/* Top row: Revenue over time + EBITDA over time */}
      <div className="flex gap-2 px-2 mb-3">
        {/* Revenue over time */}
        <div className="flex-1" style={{ minWidth: 0 }}>
          <div className="text-[8px] font-bold text-gray-600 text-center mb-1 uppercase tracking-wider">Revenue</div>
          {revenueHistory.length > 0 ? (
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={revenueHistory} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="year"
                  tick={{ fontSize: 8, fill: "#627d98", fontFamily: "JetBrains Mono, monospace" }}
                  axisLine={{ stroke: "#bcccdc" }} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 7, fill: "#627d98", fontFamily: "JetBrains Mono, monospace" }}
                  axisLine={false} tickLine={false} width={42} tickFormatter={formatAxis} />
                <Tooltip contentStyle={{
                  backgroundColor: "#0a1929", border: "1px solid #334e68",
                  borderRadius: "4px", fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: "#fff",
                }} formatter={(value: number) => [formatRevenue(value), "Revenue"]} />
                <Bar dataKey="revenue" radius={[2, 2, 0, 0]}>
                  {revenueHistory.map((_, i) => (
                    <Cell key={i} fill={i === revenueHistory.length - 1 ? "#0a1929" : "#627d98"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-gray-400 text-xs text-center py-12">No revenue data</div>
          )}
        </div>

        {/* EBITDA over time */}
        <div className="flex-1" style={{ minWidth: 0 }}>
          <div className="text-[8px] font-bold text-gray-600 text-center mb-1 uppercase tracking-wider">EBITDA</div>
          {ebitdaHistory.length > 0 ? (
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={ebitdaHistory} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="year"
                  tick={{ fontSize: 8, fill: "#627d98", fontFamily: "JetBrains Mono, monospace" }}
                  axisLine={{ stroke: "#bcccdc" }} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 7, fill: "#627d98", fontFamily: "JetBrains Mono, monospace" }}
                  axisLine={false} tickLine={false} width={42} tickFormatter={formatAxis} />
                <Tooltip contentStyle={{
                  backgroundColor: "#0a1929", border: "1px solid #334e68",
                  borderRadius: "4px", fontSize: "10px", fontFamily: "JetBrains Mono, monospace", color: "#fff",
                }} formatter={(value: number) => [formatRevenue(value), "EBITDA"]} />
                <Bar dataKey="ebitda" radius={[2, 2, 0, 0]}>
                  {ebitdaHistory.map((entry, i) => (
                    <Cell key={i} fill={entry.ebitda >= 0
                      ? (i === ebitdaHistory.length - 1 ? "#0a1929" : "#627d98")
                      : "#dc2626"
                    } />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-gray-400 text-xs text-center py-12">No EBITDA data</div>
          )}
        </div>
      </div>

      {/* Bottom row: Segment pie + Geography pie */}
      <div className="flex items-start justify-center gap-4 px-4">
        {/* Segment pie */}
        <div className="flex-1 flex flex-col items-center">
          <div className="text-[8px] font-bold text-gray-600 text-center mb-0 uppercase tracking-wider">Business Segments</div>
          <ResponsiveContainer width="100%" height={140}>
            <PieChart>
              <Pie data={segmentData} cx="50%" cy="50%" outerRadius={45} innerRadius={20}
                dataKey="value" label={renderCustomLabel} labelLine={false}>
                {segmentData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip contentStyle={{
                backgroundColor: "#0a1929", border: "1px solid #334e68",
                borderRadius: "4px", fontSize: "10px", color: "#fff",
              }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Geography pie */}
        <div className="flex-1 flex flex-col items-center">
          <div className="text-[8px] font-bold text-gray-600 text-center mb-0 uppercase tracking-wider">Geographic Revenue</div>
          <ResponsiveContainer width="100%" height={140}>
            <PieChart>
              <Pie data={geoData} cx="50%" cy="50%" outerRadius={45} innerRadius={20}
                dataKey="value" label={renderCustomLabel} labelLine={false}>
                {geoData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip contentStyle={{
                backgroundColor: "#0a1929", border: "1px solid #334e68",
                borderRadius: "4px", fontSize: "10px", color: "#fff",
              }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="text-[7px] space-y-1 pt-6 pr-1" style={{ minWidth: 70 }}>
          <div className="font-bold text-gray-500 mb-1">Geography</div>
          {geoData.map((item, i) => (
            <div key={i} className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: item.color }} />
              <span className="text-gray-600 truncate">{item.name}</span>
            </div>
          ))}
        </div>
      </div>

      <p className="text-[7px] text-gray-400 italic px-4 mt-1">
        * Segments with negative values are excluded from percentage calculations
      </p>
    </div>
  );
}
