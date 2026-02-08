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
  ReferenceLine,
} from "recharts";
import { PEPoint } from "@/lib/types";

interface Props {
  data: PEPoint[];
  forwardPE: number;
  compAvgPE: number;
  ticker: string;
}

export default function MultiplesChart({ data, forwardPE, compAvgPE, ticker }: Props) {
  if (!data || data.length === 0) {
    return <div className="text-gray-400 text-xs text-center py-8">No multiples data available</div>;
  }

  // Create comparison data showing company PE vs comp average over time
  const chartData = data.map((point) => {
    const ratio = point.pe / (forwardPE || 1);
    return {
      date: point.date,
      companyPE: point.pe,
      compAvg: Math.round(compAvgPE * ratio * 10) / 10,
    };
  });

  // Set last values to actual current values
  if (chartData.length > 0) {
    chartData[chartData.length - 1].companyPE = forwardPE;
    chartData[chartData.length - 1].compAvg = compAvgPE;
  }

  const allPE = chartData.flatMap((d) => [d.companyPE, d.compAvg]).filter((v) => v > 0);
  const minPE = Math.max(0, Math.min(...allPE) * 0.7);
  const maxPE = Math.max(...allPE) * 1.2;

  const formatDate = (date: string) => {
    const d = new Date(date);
    return d.toLocaleDateString("en-US", { year: "numeric" });
  };

  return (
    <div className="w-full">
      <div className="bg-[#1a1a1a] text-white px-4 py-2 flex items-center justify-between text-[10px] font-mono rounded-t">
        <div className="flex items-center gap-3">
          <span className="font-bold">{ticker} US</span>
          <span>Multiples - Premium to Whole Firm Comps</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-gray-400">Metric</span>
          <span className="bg-blue-600 px-2 py-0.5 rounded text-[9px]">BF P/E</span>
        </div>
      </div>

      <div className="bg-white border border-gray-300 border-t-0 px-2 pt-1">
        {/* Legend inline */}
        <div className="flex items-center gap-4 text-[9px] font-mono px-2 py-1">
          <div className="flex items-center gap-1">
            <div className="w-3 h-0.5 bg-navy-900" />
            <span className="text-gray-600">{ticker} US</span>
            <span className="font-bold text-gray-900">{forwardPE.toFixed(1)}x</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-0.5 bg-orange-500" />
            <span className="text-gray-600">Comps Avg</span>
            <span className="font-bold text-gray-900">{compAvgPE.toFixed(1)}x</span>
          </div>
        </div>

        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartData} margin={{ top: 5, right: 40, bottom: 5, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="date"
              tickFormatter={formatDate}
              tick={{ fontSize: 9, fill: "#627d98", fontFamily: "JetBrains Mono, monospace" }}
              interval={Math.floor(chartData.length / 5)}
              axisLine={{ stroke: "#bcccdc" }}
              tickLine={false}
            />
            <YAxis
              domain={[minPE, maxPE]}
              tick={{ fontSize: 9, fill: "#627d98", fontFamily: "JetBrains Mono, monospace" }}
              axisLine={false}
              tickLine={false}
              width={30}
              orientation="right"
              tickFormatter={(v) => v.toFixed(0)}
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
              formatter={(value: number, name: string) => [
                `${value.toFixed(1)}x`,
                name === "companyPE" ? `${ticker} P/E` : "Comps Avg",
              ]}
              labelFormatter={(label) =>
                new Date(label).toLocaleDateString("en-US", {
                  month: "long",
                  year: "numeric",
                })
              }
            />
            <Line
              type="monotone"
              dataKey="companyPE"
              stroke="#0a1929"
              strokeWidth={2}
              dot={false}
              name="companyPE"
            />
            <Line
              type="monotone"
              dataKey="compAvg"
              stroke="#f97316"
              strokeWidth={2}
              dot={false}
              name="compAvg"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
