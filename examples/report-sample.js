import puppeteer from 'puppeteer';

const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Interview Assessment Summary</title>
    <style>
        @page {
            size: A4 portrait;
            margin: 10mm 12mm 10mm 12mm;
        }
        *, *::before, *::after {
            box-sizing: border-box;
        }
        body {
            font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
            color: #1e293b;
            margin: 0;
            padding: 0;
            font-size: 8pt;
            line-height: 1.3;
            background-color: #f8fafc;
        }
        .header-card {
            background-color: #0f172a;
            color: #ffffff;
            padding: 10px 14px;
            border-radius: 6px;
            margin-bottom: 8px;
        }
        .header-card h1 {
            margin: 0 0 6px 0;
            font-size: 13pt;
            font-weight: 700;
            letter-spacing: -0.3px;
            color: #ffffff;
            border-bottom: 1px solid #334155;
            padding-bottom: 4px;
        }
        .meta-table { width: 100%; border-collapse: collapse; }
        .meta-table td { padding: 1px 0; font-size: 8pt; vertical-align: top; }
        .meta-label { color: #94a3b8; font-weight: 600; width: 15%; }
        .meta-value { color: #f1f5f9; font-weight: 500; width: 35%; }
        .section-title {
            font-size: 9pt;
            font-weight: 700;
            color: #0f172a;
            text-transform: uppercase;
            letter-spacing: 0.4px;
            border-left: 3px solid #2563eb;
            padding-left: 6px;
            margin: 0 0 4px 0;
        }
        .verdict-box {
            background-color: #ffffff;
            border: 1px solid #e2e8f0;
            border-left: 4px solid #2563eb;
            border-radius: 4px;
            padding: 6px 10px;
            margin-bottom: 8px;
        }
        .verdict-badge {
            display: inline-block;
            background-color: #dbeafe;
            color: #1e40af;
            font-weight: 700;
            font-size: 8.5pt;
            padding: 2px 6px;
            border-radius: 3px;
            margin-bottom: 3px;
        }
        .verdict-text { color: #334155; margin: 0; font-size: 8pt; }
        .grid-table {
            width: 100%;
            border-collapse: separate;
            border-spacing: 8px 0;
            margin-left: -8px;
            margin-right: -8px;
            margin-bottom: 8px;
        }
        .grid-cell {
            width: 50%;
            vertical-align: top;
            background: #ffffff;
            border: 1px solid #e2e8f0;
            border-radius: 4px;
            padding: 8px 10px;
        }
        ul.custom-list { margin: 0; padding-left: 14px; }
        ul.custom-list li { margin-bottom: 3px; color: #334155; }
        ul.custom-list li:last-child { margin-bottom: 0; }
        ul.custom-list strong { color: #0f172a; }
        .card-block {
            background: #ffffff;
            border: 1px solid #e2e8f0;
            border-radius: 4px;
            padding: 6px 10px;
            margin-bottom: 8px;
        }
        .card-block p { margin-top: 0; margin-bottom: 4px; color: #334155; }
        .progression-table {
            width: 100%;
            border-collapse: collapse;
            background: #ffffff;
            border: 1px solid #e2e8f0;
            border-radius: 4px;
            margin-bottom: 8px;
        }
        .progression-table td {
            padding: 6px 8px;
            vertical-align: top;
            border-right: 1px solid #f1f5f9;
            width: 33.33%;
        }
        .progression-table td:last-child { border-right: none; }
        .prog-header {
            font-weight: 700;
            color: #1e40af;
            font-size: 8.5pt;
            margin-bottom: 3px;
            border-bottom: 1px solid #e2e8f0;
            padding-bottom: 2px;
        }
        ol.action-list { margin: 0; padding-left: 14px; }
        ol.action-list li { margin-bottom: 3px; color: #334155; }
        ol.action-list li:last-child { margin-bottom: 0; }
        ol.action-list strong { color: #0f172a; }
        .rec-box {
            background-color: #f0fdf4;
            border: 1px solid #bbf7d0;
            border-left: 4px solid #16a34a;
            border-radius: 4px;
            padding: 6px 10px;
        }
        .rec-badge {
            display: inline-block;
            background-color: #dcfce7;
            color: #15803d;
            font-weight: 700;
            font-size: 8.5pt;
            padding: 2px 6px;
            border-radius: 3px;
            margin-bottom: 3px;
        }
    </style>
</head>
<body>
    <div class="header-card">
        <h1>Interview Assessment Summary</h1>
        <table class="meta-table">
            <tr>
                <td class="meta-label">Candidate:</td>
                <td class="meta-value">Alex Mercer</td>
                <td class="meta-label">Target Role:</td>
                <td class="meta-value">Senior Product Manager</td>
            </tr>
            <tr>
                <td class="meta-label">Client/Company:</td>
                <td class="meta-value">Fintech Solutions Inc.</td>
                <td class="meta-label">Coverage:</td>
                <td class="meta-value">Mock 1 to Mock 3</td>
            </tr>
        </table>
    </div>
    <div style="margin-bottom: 8px;">
        <div class="section-title">Overall Verdict</div>
        <div class="verdict-box">
            <div class="verdict-badge">Leaning Hire</div>
            <p class="verdict-text">
                Alex demonstrated a strong upward trajectory over three mocks, progressing from a readiness score of <strong>5.5/10</strong> to <strong>7.5/10</strong>. Core strengths include high EQ, deep product vision, and rapid coachability. With targeted polish around framing quantifiable business outcomes, he is well-positioned to clear client rounds.
            </p>
        </div>
    </div>
    <table class="grid-table">
        <tr>
            <td class="grid-cell">
                <div class="section-title" style="border-color: #16a34a;">Key Strengths</div>
                <ul class="custom-list">
                    <li><strong>Composure & Presence:</strong> Calm, articulate under pressure; handles probing questions thoughtfully.</li>
                    <li><strong>Stakeholder Context:</strong> Clear empathy for engineering, design, and GTM constraints.</li>
                    <li><strong>High Learning Agility:</strong> Rapidly absorbed feedback and implemented frameworks between sessions.</li>
                    <li><strong>Product Vision:</strong> Articulates positioning and customer empathy, aligning solutions with goals.</li>
                </ul>
            </td>
            <td class="grid-cell">
                <div class="section-title" style="border-color: #dc2626;">Key Development Areas</div>
                <ul class="custom-list">
                    <li><strong>Opening Directness:</strong> Gives extensive background setup before answering core questions.</li>
                    <li><strong>STAR Consistency:</strong> Occasional structural drift blurring Action and Result phases.</li>
                    <li><strong>Quantifiable Metrics:</strong> Needs consistent integration of hard metrics (e.g., ARR impact, retention lift).</li>
                    <li><strong>Personal Ownership:</strong> Attributes deliverables to "the team" rather than explicit leadership.</li>
                </ul>
            </td>
        </tr>
    </table>
    <div style="margin-bottom: 8px;">
        <div class="section-title">Domain Knowledge Assessment</div>
        <div class="card-block">
            <p>Solid generalist background, but requires greater depth in financial technology mechanisms:</p>
            <table style="width: 100%; border-collapse: collapse;">
                <tr>
                    <td style="width: 50%; vertical-align: top;">
                        <ul class="custom-list">
                            <li><strong>Regulatory & Compliance:</strong> KYC/AML and open banking data residency.</li>
                            <li><strong>Payment Rails:</strong> Failure modes between ACH, RTP, and card networks.</li>
                        </ul>
                    </td>
                    <td style="width: 50%; vertical-align: top;">
                        <ul class="custom-list">
                            <li><strong>Risk Systems:</strong> Real-time fraud detection and risk engine trade-offs.</li>
                            <li><strong>Unit Economics:</strong> Processing margins, interchange fees, and NRR drivers.</li>
                        </ul>
                    </td>
                </tr>
            </table>
        </div>
    </div>
    <div style="margin-bottom: 8px;">
        <div class="section-title">Interview Progression</div>
        <table class="progression-table">
            <tr>
                <td>
                    <div class="prog-header">Mock 1</div>
                    <ul class="custom-list">
                        <li>Overly verbose answers (up to 3 mins to thesis).</li>
                        <li>Lacked clear frameworks for behavioral queries.</li>
                        <li>Missing business outcomes in 4/5 scenarios.</li>
                    </ul>
                </td>
                <td>
                    <div class="prog-header">Mock 2</div>
                    <ul class="custom-list">
                        <li>Improved concise openings and summary framing.</li>
                        <li>Adopted STAR structure; actions remained team-centric.</li>
                        <li>Relied on qualitative results over hard metrics.</li>
                    </ul>
                </td>
                <td>
                    <div class="prog-header">Mock 3</div>
                    <ul class="custom-list">
                        <li>Crisp 60–90s executive delivery on prompts.</li>
                        <li>Clear ownership of roadmap trade-offs.</li>
                        <li>Minor shallow areas in fintech compliance.</li>
                    </ul>
                </td>
            </tr>
        </table>
    </div>
    <table class="grid-table">
        <tr>
            <td class="grid-cell">
                <div class="section-title" style="border-color: #d97706;">Primary Interview Risks</div>
                <ul class="custom-list">
                    <li><strong>Conversational Drift:</strong> Reverting to unfocused anecdotes if pressed on technical depth.</li>
                    <li><strong>Diffused Ownership:</strong> Senior interviewers may perceive lack of personal drive.</li>
                    <li><strong>Weak ROI Articulation:</strong> Missing chances to prove impact with baseline vs. post-launch data.</li>
                    <li><strong>High-Level Abstraction:</strong> Using general terms without concrete procedural details.</li>
                </ul>
            </td>
            <td class="grid-cell">
                <div class="section-title">Recommended Coach Actions</div>
                <ol class="action-list">
                    <li><strong>STAR Drills:</strong> Rehearse 4 core stories emphasizing "I" over "We".</li>
                    <li><strong>Metric Enforcer:</strong> Quick-fire drills requiring metric metrics in every answer.</li>
                    <li><strong>Domain Refresher:</strong> Assign payment architecture & compliance study.</li>
                    <li><strong>BLUF Practice:</strong> Deliver 10-second summary before narrative context.</li>
                    <li><strong>Final Mock:</strong> 30-min pressure-test simulation on executive delivery.</li>
                </ol>
            </td>
        </tr>
    </table>
    <div>
        <div class="section-title">Final Recommendation</div>
        <div class="rec-box">
            <div class="rec-badge">Leaning Hire with Reservations</div>
            <p class="verdict-text">
                Alex exhibits high potential and strong product intuition. Client submission should be held until completing domain reframing and metric drills to ensure reliable execution under high pressure.
            </p>
        </div>
    </div>
</body>
</html>`;

async function generatePDF() {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    // Set HTML content directly
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

    // Generate PDF matching @page CSS rules
    await page.pdf({
        path: 'interview_assessment_summary_single_page.pdf',
        format: 'A4',
        printBackground: true, // Enables background colors and styling
        preferCSSPageSize: true // Respects @page CSS definitions (margins/size)
    });

    await browser.close();
    console.log('PDF generated successfully!');
}

generatePDF();