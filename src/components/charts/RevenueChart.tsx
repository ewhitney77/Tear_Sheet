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
} from "recharts";
import { RevenuePoint } from "@/lib/types";

interface Props {
  data: RevenuePoint[];
  compact?: boolean;
}

export default function RevenueChart({ data, compact }: Props) {
  if (!data || data.length === 0) {
    return <div className="text-gray-400 text-xs text-center py-8">No revenue data available</div>;
  }

  const maxRev = Math.max(...data.map((d) => d.revenue));
  const formatRevenue = (val: number) => {
    if (val >= 1e9) return `$${(val / 1e9).toFixed(0)}B`;
    if (val >= 1e6) return `$${(val / 1e6).toFixed(0)}M`;
    return `$${val.toLocaleString()}`;
  };

  if (compact) {
    return (
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} margin={{ top: 10, right: 5, bottom: 5, left: 5 }}>
          <XAxis
            dataKey="year"
            tick={{ fontSize: 8, fill: "#627d98" }}
            axisLine={{ stroke: "#bcccdc" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 8, fill: "#627d98" }}
            axisLine={false}
            tickLine={false}
            width={45}
            tickFormatter={formatRevenue}
          />
          <Bar dataKey="revenue" radius={[2, 2, 0, 0]}>
            {data.map((entry, index) => (
              <Cell
                key={index}
                fill={entry.growth !== null && entry.growth >= 0 ? "#0a1929" : "#829ab1"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 15, right: 15, bottom: 5, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
        <XAxis
          dataKey="year"
          tick={{ fontSize: 10, fill: "#627d98", fontFamily: "JetBrains Mono, monospace" }}
          axisLine={{ stroke: "#bcccdc" }}
          tickLine={false}
        />
        <YAxis
          domain={[0, maxRev * 1.15]}
          tick={{ fontSize: 9, fill: "#627d98", fontFamily: "JetBrains Mono, monospace" }}
          axisLine={false}
          tickLine={false}
          width={55}
          tickFormatter={formatRevenue}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "#0a1929",
            border: "1px solid #334e68",
            borderRadius: "6px",
            fontSize: "11px",
            fontFamily: "JetBrains Mono, monospace",
            color: "#fff",
          }}
          formatter={(value: number, name: string) => {
            if (name === "revenue") return [formatRevenue(value), "Revenue"];
            return [value, name];
          }}
        />
        <Bar dataKey="revenue" radius={[3, 3, 0, 0]}>
          {data.map((entry, index) => (
            <Cell
              key={index}
              fill={entry.growth !== null && entry.growth >= 0 ? "#0a1929" : "#829ab1"}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
