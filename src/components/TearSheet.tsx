"use client";

import { useRef, useCallback } from "react";
import { StockData } from "@/lib/types";
import dynamic from "next/dynamic";

const PriceChart = dynamic(() => import("./charts/PriceChart"), { ssr: false });
const EPSChart = dynamic(() => import("./charts/EPSChart"), { ssr: false });
const PEChart = dynamic(() => import("./charts/PEChart"), { ssr: false });
const RevenueChart = dynamic(() => import("./charts/RevenueChart"), { ssr: false });
const SegmentCharts = dynamic(() => import("./charts/SegmentCharts"), { ssr: false });
const MultiplesChart = dynamic(() => import("./charts/MultiplesChart"), { ssr: false });

interface Props {
  data: StockData;
}

export default function TearSheet({ data }: Props) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const citationsRef = useRef<HTMLDivElement>(null);

  const handleExportPDF = useCallback(async () => {
    const html2canvas = (await import("html2canvas")).default;
    const jsPDF = (await import("jspdf")).default;

    const pdf = new jsPDF("p", "mm", "letter");
    const pageWidth = 215.9;
    const pageHeight = 279.4;
    const margin = 6;

    // Page 1: Tear sheet
    if (sheetRef.current) {
      const canvas = await html2canvas(sheetRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false,
        width: sheetRef.current.scrollWidth,
        height: sheetRef.current.scrollHeight,
      });
      const imgData = canvas.toDataURL("image/png");
      const imgWidth = pageWidth - margin * 2;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      if (imgHeight > pageHeight - margin * 2) {
        const scale = (pageHeight - margin * 2) / imgHeight;
        pdf.addImage(imgData, "PNG", margin, margin, imgWidth * scale, (pageHeight - margin * 2));
      } else {
        pdf.addImage(imgData, "PNG", margin, margin, imgWidth, imgHeight);
      }
    }

    // Page 2: Citations
    if (citationsRef.current) {
      pdf.addPage();
      const canvas = await html2canvas(citationsRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
        logging: false,
      });
      const imgData = canvas.toDataURL("image/png");
      const imgWidth = pageWidth - margin * 2;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      pdf.addImage(imgData, "PNG", margin, margin, imgWidth, Math.min(imgHeight, pageHeight - margin * 2));
    }

    pdf.save(`${data.ticker}_TearSheet_${new Date().toISOString().split("T")[0]}.pdf`);
  }, [data.ticker]);

  const formatMarketCap = (cap: number) => {
    if (cap >= 1e12) return `$${(cap / 1e12).toFixed(1)} Tril.`;
    if (cap >= 1e9) return `$${(cap / 1e9).toFixed(1)} Bil.`;
    if (cap >= 1e6) return `$${(cap / 1e6).toFixed(1)} Mil.`;
    return `$${cap.toLocaleString()}`;
  };

  return (
    <div className="max-w-[1400px] mx-auto px-4 py-6">
      {/* Export button */}
      <div className="flex justify-end mb-4 no-print">
        <button
          onClick={handleExportPDF}
          className="px-6 py-2 bg-white text-navy-900 text-sm font-semibold rounded-lg hover:bg-navy-100 transition-all flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          EXPORT PDF
        </button>
      </div>

      {/* PAGE 1: Main Tear Sheet */}
      <div ref={sheetRef} className="tear-sheet-content bg-white rounded-lg shadow-2xl" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
        {/* Header banner */}
        <div className="bg-[#c8c8c8] py-2 px-6 rounded-t-lg">
          <h1 className="text-center text-lg font-bold tracking-widest text-black" style={{ fontFamily: "Georgia, serif" }}>
            WAVERLY ADVISORS&mdash;EQUITY RESEARCH
          </h1>
        </div>

        {/* Sub-header info */}
        <div className="flex justify-between items-center px-6 py-2 border-b border-gray-300 text-xs text-gray-700">
          <div>Analyst: <span className="font-semibold">{data.analystName}</span></div>
          <div>Telephone: {data.telephone}</div>
          <div>Date: {data.generatedDate}</div>
        </div>

        {/* Main content - two column layout */}
        <div className="flex gap-0">
          {/* LEFT COLUMN - Company info + small charts */}
          <div className="w-[320px] flex-shrink-0 border-r border-gray-200 p-4">
            {/* Company info table */}
            <table className="w-full text-xs border-collapse mb-4">
              <tbody>
                {[
                  ["Company Name", data.companyName],
                  ["Bloomberg Ticker", data.ticker],
                  ["Market Cap.", formatMarketCap(data.marketCap)],
                  ["Sector", data.sector],
                  ["Industry", data.industry],
                  ["Dividend Yield", `${data.dividendYield.toFixed(1)}%`],
                  ["Div. Growth Est.", `${data.dividendGrowthEst.toFixed(1)}%`],
                  ["Short Interest Ratio", data.shortInterestRatio.toFixed(1)],
                  ["W.A. Analyst Rating", data.analystRating],
                  ["W.A. Risk Rating", data.riskRating],
                  ["Appropriateness Rating", data.appropriatenessRating],
                ].map(([label, value], i) => (
                  <tr key={i} className={i % 2 === 0 ? "bg-gray-50" : "bg-white"}>
                    <td className="py-1.5 px-2 font-medium text-gray-700 border border-gray-200">{label}</td>
                    <td className="py-1.5 px-2 text-gray-900 border border-gray-200 font-semibold">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Stock Price History */}
            <div className="border border-gray-200 rounded p-2 mb-3">
              <h3 className="text-[10px] font-bold text-gray-900 mb-1 underline">Stock Price History</h3>
              <PriceChart data={data.priceHistory} compact />
            </div>

            {/* EPS Estimate Trend */}
            <div className="border border-gray-200 rounded p-2 mb-3">
              <h3 className="text-[10px] font-bold text-gray-900 mb-1 underline">EPS Estimate Trend:</h3>
              <EPSChart data={data.epsEstimates} compact />
            </div>

            {/* P/E History */}
            <div className="border border-gray-200 rounded p-2 mb-3">
              <h3 className="text-[10px] font-bold text-gray-900 mb-1 underline">P/E History</h3>
              <PEChart data={data.peHistory} compact />
            </div>

            {/* Revenue Growth */}
            <div className="border border-gray-200 rounded p-2">
              <h3 className="text-[10px] font-bold text-gray-900 mb-1 underline">Revenue Growth:</h3>
              <RevenueChart data={data.revenueHistory} compact />
            </div>
          </div>

          {/* RIGHT COLUMN - Thesis, risks, segment charts, multiples */}
          <div className="flex-1 p-4 space-y-4">
            {/* What Does the Company Do? */}
            <div className="border border-gray-200 rounded p-4">
              <h3 className="text-sm font-bold text-navy-900 underline mb-2">What Does the Company Do?</h3>
              <p className="text-[11px] leading-relaxed text-gray-700">{data.description}</p>
            </div>

            {/* Thesis */}
            <div className="border border-gray-200 rounded p-4">
              <h3 className="text-sm font-bold text-navy-900 underline mb-2">Thesis:</h3>
              {data.thesis.map((point, i) => (
                <div key={i} className="mb-2">
                  <p className="text-[11px] leading-relaxed text-gray-700">
                    <span className="font-bold text-gray-900">{point.title}:</span>{" "}
                    {point.description}
                  </p>
                </div>
              ))}
            </div>

            {/* Risks */}
            <div className="border border-gray-200 rounded p-4">
              <h3 className="text-sm font-bold text-navy-900 underline mb-2">Risks (Where we could be wrong):</h3>
              {data.risks.map((point, i) => (
                <div key={i} className="mb-2">
                  <p className="text-[11px] leading-relaxed text-gray-700">
                    <span className="font-bold text-gray-900">{point.title}:</span>{" "}
                    {point.description}
                  </p>
                </div>
              ))}
            </div>

            {/* Revenue Segments */}
            <div className="border border-gray-200 rounded p-2">
              <SegmentCharts
                segmentData={data.revenueBySegment}
                geoData={data.revenueByGeography}
                revenueHistory={data.revenueHistory}
              />
            </div>

            {/* Multiples Comparison */}
            <div className="border border-gray-200 rounded overflow-hidden">
              <MultiplesChart
                data={data.peHistory}
                forwardPE={data.forwardPE}
                compAvgPE={data.compAvgPE}
                ticker={data.ticker}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-300 px-6 py-2 text-center">
          <p className="text-[8px] text-gray-400 italic">
            This report is for informational purposes only and does not constitute investment advice. Past performance is not indicative of future results. Waverly Advisors is not responsible for errors or omissions.
          </p>
        </div>
      </div>

      {/* PAGE 2: Citations */}
      <div ref={citationsRef} className="tear-sheet-content bg-white rounded-lg shadow-2xl mt-8" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
        {/* Header banner */}
        <div className="bg-[#c8c8c8] py-2 px-6 rounded-t-lg">
          <h1 className="text-center text-lg font-bold tracking-widest text-black" style={{ fontFamily: "Georgia, serif" }}>
            WAVERLY ADVISORS&mdash;EQUITY RESEARCH
          </h1>
        </div>

        <div className="px-8 py-6">
          <h2 className="text-lg font-bold text-navy-900 mb-1">Sources & Citations</h2>
          <p className="text-xs text-gray-500 mb-6">
            {data.companyName} ({data.ticker}) &mdash; Report generated {data.generatedDate}
          </p>

          <div className="border-t border-gray-200 pt-4">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b-2 border-gray-300">
                  <th className="text-left py-2 px-2 font-semibold text-gray-700 w-8">#</th>
                  <th className="text-left py-2 px-2 font-semibold text-gray-700">Source</th>
                  <th className="text-left py-2 px-2 font-semibold text-gray-700">Description</th>
                  <th className="text-left py-2 px-2 font-semibold text-gray-700">URL</th>
                  <th className="text-left py-2 px-2 font-semibold text-gray-700 w-24">Accessed</th>
                </tr>
              </thead>
              <tbody>
                {data.citations.map((citation, i) => (
                  <tr key={i} className={`${i % 2 === 0 ? "bg-gray-50" : "bg-white"} border-b border-gray-100`}>
                    <td className="py-2 px-2 text-gray-500">{i + 1}</td>
                    <td className="py-2 px-2 font-medium text-gray-900">{citation.source}</td>
                    <td className="py-2 px-2 text-gray-600">{citation.description}</td>
                    <td className="py-2 px-2 text-blue-600 break-all text-[9px]">{citation.url}</td>
                    <td className="py-2 px-2 text-gray-500">{citation.accessDate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-8 pt-4 border-t border-gray-200">
            <p className="text-[9px] text-gray-500 leading-relaxed">
              <strong>Disclaimer:</strong> This equity research report has been prepared by Waverly Advisors for informational purposes only.
              The information contained herein is obtained from sources believed to be reliable, but no representation or warranty, expressed or implied,
              is made as to its accuracy, completeness, or correctness. This report does not constitute an offer, solicitation, or recommendation for the
              purchase or sale of any security. Investment decisions should be made based on an individual&apos;s own due diligence and consultation with a
              qualified financial advisor. Past performance is not indicative of future results. All investments involve risk, including the potential loss
              of principal. Waverly Advisors, its affiliates, officers, directors, and employees may hold positions in the securities discussed in this report.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
