"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  ComposedChart,
  Bar,
} from "recharts";
import { PricePoint } from "@/lib/types";

interface Props {
  data: PricePoint[];
  compact?: boolean;
}

export default function PriceChart({ data, compact }: Props) {
  if (!data || data.length === 0) {
    return <div className="text-gray-400 text-xs text-center py-8">No price data available</div>;
  }

  // Sample data for readability if too many points
  const sampled = data.length > 200
    ? data.filter((_, i) => i % Math.ceil(data.length / 200) === 0 || i === data.length - 1)
    : data;

  const minPrice = Math.min(...sampled.map((d) => d.close)) * 0.95;
  const maxPrice = Math.max(...sampled.map((d) => d.close)) * 1.05;
  const maxVol = Math.max(...sampled.map((d) => d.volume));

  const formatDate = (date: string) => {
    const d = new Date(date);
    return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  };

  const formatPrice = (val: number) => `$${val.toFixed(0)}`;

  if (compact) {
    return (
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={sampled} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
          <Line
            type="monotone"
            dataKey="close"
            stroke="#0a1929"
            strokeWidth={1.5}
            dot={false}
          />
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            tick={{ fontSize: 8, fill: "#627d98" }}
            interval={Math.floor(sampled.length / 4)}
            axisLine={{ stroke: "#bcccdc" }}
            tickLine={false}
          />
          <YAxis
            domain={[minPrice, maxPrice]}
            tickFormatter={formatPrice}
            tick={{ fontSize: 8, fill: "#627d98" }}
            axisLine={false}
            tickLine={false}
            width={40}
          />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <ComposedChart data={sampled} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis
          dataKey="date"
          tickFormatter={formatDate}
          tick={{ fontSize: 9, fill: "#627d98", fontFamily: "JetBrains Mono, monospace" }}
          interval={Math.floor(sampled.length / 6)}
          axisLine={{ stroke: "#bcccdc" }}
          tickLine={false}
        />
        <YAxis
          yAxisId="price"
          domain={[minPrice, maxPrice]}
          tickFormatter={formatPrice}
          tick={{ fontSize: 9, fill: "#627d98", fontFamily: "JetBrains Mono, monospace" }}
          axisLine={false}
          tickLine={false}
          width={50}
        />
        <YAxis
          yAxisId="volume"
          orientation="right"
          domain={[0, maxVol * 4]}
          tick={false}
          axisLine={false}
          tickLine={false}
          width={0}
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
            if (name === "close") return [`$${value.toFixed(2)}`, "Price"];
            if (name === "volume") return [(value / 1e6).toFixed(1) + "M", "Volume"];
            return [value, name];
          }}
          labelFormatter={(label) =>
            new Date(label).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })
          }
        />
        <Bar
          yAxisId="volume"
          dataKey="volume"
          fill="#d9e2ec"
          opacity={0.4}
        />
        <Area
          yAxisId="price"
          type="monotone"
          dataKey="close"
          stroke="#0a1929"
          strokeWidth={1.5}
          fill="url(#priceGradient)"
          dot={false}
        />
        <Line
          yAxisId="price"
          type="monotone"
          dataKey="close"
          stroke="#0a1929"
          strokeWidth={2}
          dot={false}
        />
        <defs>
          <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#0a1929" stopOpacity={0.15} />
            <stop offset="95%" stopColor="#0a1929" stopOpacity={0.02} />
          </linearGradient>
        </defs>
      </ComposedChart>
    </ResponsiveContainer>
  );
}
