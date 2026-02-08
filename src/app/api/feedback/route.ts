import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ticker, issues } = body;

    if (!ticker && !issues) {
      return NextResponse.json({ error: "Please provide feedback" }, { status: 400 });
    }

    const subject = encodeURIComponent(`Tear Sheet Feedback: ${ticker || "General"}`);
    const emailBody = [
      `Ticker Used: ${ticker || "N/A"}`,
      "",
      `Issues / Feedback:`,
      issues || "No additional details provided",
      "",
      `---`,
      `Sent from Waverly Advisors Tear Sheet Generator`,
      `Date: ${new Date().toLocaleString("en-US")}`,
    ].join("\n");

    // Use mailto approach - return the mailto URL for the client to open
    const mailtoUrl = `mailto:ewhitney777@gmail.com?subject=${subject}&body=${encodeURIComponent(emailBody)}`;

    return NextResponse.json({ success: true, mailtoUrl });
  } catch (error) {
    console.error("Feedback error:", error);
    return NextResponse.json({ error: "Failed to process feedback" }, { status: 500 });
  }
}
