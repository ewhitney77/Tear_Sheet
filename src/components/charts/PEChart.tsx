"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { PEPoint } from "@/lib/types";

interface Props {
  data: PEPoint[];
  compact?: boolean;
}

export default function PEChart({ data, compact }: Props) {
  if (!data || data.length === 0) {
    return <div className="text-gray-400 text-xs text-center py-8">No P/E data available</div>;
  }

  const values = data.map((d) => d.pe).filter((v) => v > 0 && v < 200);
  const minPE = Math.max(0, Math.min(...values) * 0.8);
  const maxPE = Math.max(...values) * 1.15;

  const formatDate = (date: string) => {
    const d = new Date(date);
    return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  };

  if (compact) {
    return (
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            tick={{ fontSize: 8, fill: "#627d98" }}
            interval={Math.floor(data.length / 4)}
            axisLine={{ stroke: "#bcccdc" }}
            tickLine={false}
          />
          <YAxis
            domain={[minPE, maxPE]}
            tick={{ fontSize: 8, fill: "#627d98" }}
            axisLine={false}
            tickLine={false}
            width={30}
            tickFormatter={(v) => `${v.toFixed(0)}x`}
          />
          <Line type="monotone" dataKey="pe" stroke="#0a1929" strokeWidth={1.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 5, right: 15, bottom: 5, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis
          dataKey="date"
          tickFormatter={formatDate}
          tick={{ fontSize: 9, fill: "#627d98", fontFamily: "JetBrains Mono, monospace" }}
          interval={Math.floor(data.length / 6)}
          axisLine={{ stroke: "#bcccdc" }}
          tickLine={false}
        />
        <YAxis
          domain={[minPE, maxPE]}
          tick={{ fontSize: 9, fill: "#627d98", fontFamily: "JetBrains Mono, monospace" }}
          axisLine={false}
          tickLine={false}
          width={40}
          tickFormatter={(v) => `${v.toFixed(0)}x`}
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
          formatter={(value: number) => [`${value.toFixed(1)}x`, "P/E Ratio"]}
          labelFormatter={(label) =>
            new Date(label).toLocaleDateString("en-US", {
              month: "long",
              year: "numeric",
            })
          }
        />
        <Line type="monotone" dataKey="pe" stroke="#0a1929" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
