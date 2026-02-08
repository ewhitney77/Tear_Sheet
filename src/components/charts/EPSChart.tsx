"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { EPSPoint } from "@/lib/types";

interface Props {
  data: EPSPoint[];
  compact?: boolean;
}

export default function EPSChart({ data, compact }: Props) {
  if (!data || data.length === 0) {
    return <div className="text-gray-400 text-xs text-center py-8">No EPS data available</div>;
  }

  const allValues = data.flatMap((d) => [d.actual, d.estimate].filter((v): v is number => v !== null));
  const minVal = allValues.length > 0 ? Math.min(...allValues) * 0.9 : 0;
  const maxVal = allValues.length > 0 ? Math.max(...allValues) * 1.1 : 10;

  if (compact) {
    return (
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <XAxis
            dataKey="period"
            tick={{ fontSize: 8, fill: "#627d98" }}
            axisLine={{ stroke: "#bcccdc" }}
            tickLine={false}
          />
          <YAxis
            domain={[minVal, maxVal]}
            tick={{ fontSize: 8, fill: "#627d98" }}
            axisLine={false}
            tickLine={false}
            width={35}
            tickFormatter={(v) => `$${v.toFixed(2)}`}
          />
          <Line type="monotone" dataKey="actual" stroke="#0a1929" strokeWidth={2} dot={{ r: 3, fill: "#0a1929" }} connectNulls />
          <Line type="monotone" dataKey="estimate" stroke="#dc2626" strokeWidth={1.5} strokeDasharray="5 5" dot={{ r: 2, fill: "#dc2626" }} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 5, right: 15, bottom: 5, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis
          dataKey="period"
          tick={{ fontSize: 9, fill: "#627d98", fontFamily: "JetBrains Mono, monospace" }}
          axisLine={{ stroke: "#bcccdc" }}
          tickLine={false}
        />
        <YAxis
          domain={[minVal, maxVal]}
          tick={{ fontSize: 9, fill: "#627d98", fontFamily: "JetBrains Mono, monospace" }}
          axisLine={false}
          tickLine={false}
          width={45}
          tickFormatter={(v) => `$${v.toFixed(2)}`}
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
          formatter={(value: number | null, name: string) => {
            if (value === null) return ["N/A", name];
            return [`$${value.toFixed(2)}`, name === "actual" ? "Actual EPS" : "Estimated EPS"];
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: "10px", fontFamily: "JetBrains Mono, monospace" }}
          formatter={(value) => (value === "actual" ? "Actual" : "Estimate")}
        />
        <Line
          type="monotone"
          dataKey="actual"
          stroke="#0a1929"
          strokeWidth={2}
          dot={{ r: 3, fill: "#0a1929", strokeWidth: 0 }}
          connectNulls
        />
        <Line
          type="monotone"
          dataKey="estimate"
          stroke="#dc2626"
          strokeWidth={1.5}
          strokeDasharray="5 5"
          dot={{ r: 2, fill: "#dc2626", strokeWidth: 0 }}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
