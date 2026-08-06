# -*- coding: utf-8 -*-
"""Generate a stakeholder demo / usage PDF for the Signage Field Operations app."""

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle,
    PageBreak, ListFlowable, ListItem, HRFlowable, KeepTogether, NextPageTemplate
)
from reportlab.platypus.flowables import Flowable
import datetime

# ---------------------------------------------------------------- palette
BRAND      = colors.HexColor("#0B5394")   # deep corporate blue
BRAND_DK   = colors.HexColor("#073763")
ACCENT     = colors.HexColor("#E8A33D")   # amber accent
LIGHT_BG   = colors.HexColor("#EEF3F8")
GREY_TX    = colors.HexColor("#444444")
LINE_GREY  = colors.HexColor("#C9D4E0")
GREEN      = colors.HexColor("#2E7D32")

OUTPUT = "Signage_App_Demo_VBL.pdf"

# ---------------------------------------------------------------- styles
styles = getSampleStyleSheet()

def S(name, **kw):
    styles.add(ParagraphStyle(name, **kw))

S("CoverTitle", fontName="Helvetica-Bold", fontSize=30, leading=36,
  textColor=colors.white, alignment=TA_CENTER)
S("CoverSub", fontName="Helvetica", fontSize=14, leading=20,
  textColor=colors.white, alignment=TA_CENTER)
S("CoverMeta", fontName="Helvetica", fontSize=10.5, leading=16,
  textColor=colors.HexColor("#D6E2F0"), alignment=TA_CENTER)
S("H1", fontName="Helvetica-Bold", fontSize=17, leading=21,
  textColor=BRAND_DK, spaceBefore=6, spaceAfter=8)
S("H2", fontName="Helvetica-Bold", fontSize=12.5, leading=16,
  textColor=BRAND, spaceBefore=10, spaceAfter=4)
S("Body", fontName="Helvetica", fontSize=10.5, leading=15.5,
  textColor=GREY_TX, alignment=TA_JUSTIFY, spaceAfter=6)
S("Bull", fontName="Helvetica", fontSize=10.5, leading=15,
  textColor=GREY_TX)
S("Lead", fontName="Helvetica-Oblique", fontSize=11, leading=16,
  textColor=BRAND_DK, spaceAfter=8)
S("Small", fontName="Helvetica", fontSize=8.5, leading=12,
  textColor=colors.HexColor("#7A7A7A"))
S("StepNum", fontName="Helvetica-Bold", fontSize=11, leading=14,
  textColor=colors.white, alignment=TA_CENTER)
S("TblHead", fontName="Helvetica-Bold", fontSize=9.5, leading=12,
  textColor=colors.white)
S("TblCell", fontName="Helvetica", fontSize=9.5, leading=13,
  textColor=GREY_TX)
S("TblCellB", fontName="Helvetica-Bold", fontSize=9.5, leading=13,
  textColor=BRAND_DK)

# ---------------------------------------------------------------- helpers
def bullets(items, style="Bull"):
    return ListFlowable(
        [ListItem(Paragraph(t, styles[style]), leftIndent=6,
                  value="•", bulletColor=ACCENT) for t in items],
        bulletType="bullet", start="•", leftIndent=14, spaceAfter=6,
    )

class Pill(Flowable):
    """A colored rounded label used as a section divider chip."""
    def __init__(self, text, w=170*mm, h=9*mm, bg=BRAND, fg=colors.white):
        super().__init__()
        self.text, self.w, self.h, self.bg, self.fg = text, w, h, bg, fg
    def wrap(self, *a): return (self.w, self.h)
    def draw(self):
        c = self.canv
        c.setFillColor(self.bg)
        c.roundRect(0, 0, self.w, self.h, 3, fill=1, stroke=0)
        c.setFillColor(ACCENT)
        c.roundRect(0, 0, 4, self.h, 0, fill=1, stroke=0)
        c.setFillColor(self.fg)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(12, self.h/2 - 4, self.text)

def step_block(num, title, body_items):
    """A numbered step: circle number + title + bullets, kept together."""
    circle = Table([[Paragraph(str(num), styles["StepNum"])]],
                   colWidths=[9*mm], rowHeights=[9*mm])
    circle.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), BRAND),
        ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
        ("ALIGN", (0,0), (-1,-1), "CENTER"),
        ("ROUNDEDCORNERS", [4,4,4,4]),
    ]))
    head = Table([[circle, Paragraph(title, styles["H2"])]],
                 colWidths=[12*mm, 158*mm])
    head.setStyle(TableStyle([
        ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
        ("LEFTPADDING", (0,0), (-1,-1), 0),
        ("TOPPADDING", (1,0), (1,0), 0),
        ("BOTTOMPADDING", (0,0), (-1,-1), 2),
    ]))
    inner = bullets(body_items)
    wrap = Table([[head],[Table([[ "", inner]], colWidths=[12*mm, 158*mm])]],
                 colWidths=[170*mm])
    wrap.setStyle(TableStyle([
        ("LEFTPADDING",(0,0),(-1,-1),0),("RIGHTPADDING",(0,0),(-1,-1),0),
        ("TOPPADDING",(0,0),(-1,-1),0),("BOTTOMPADDING",(0,0),(-1,-1),2),
    ]))
    return KeepTogether([wrap, Spacer(1, 6)])

def data_table(header, rows, col_widths):
    data = [[Paragraph(h, styles["TblHead"]) for h in header]]
    for r in rows:
        data.append([Paragraph(c, styles["TblCell"]) for c in r])
    t = Table(data, colWidths=col_widths, repeatRows=1)
    style = [
        ("BACKGROUND", (0,0), (-1,0), BRAND),
        ("ROWBACKGROUNDS", (0,1), (-1,-1), [colors.white, LIGHT_BG]),
        ("GRID", (0,0), (-1,-1), 0.5, LINE_GREY),
        ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
        ("TOPPADDING", (0,0), (-1,-1), 5),
        ("BOTTOMPADDING", (0,0), (-1,-1), 5),
        ("LEFTPADDING", (0,0), (-1,-1), 7),
        ("RIGHTPADDING", (0,0), (-1,-1), 7),
    ]
    t.setStyle(TableStyle(style))
    return t

# ---------------------------------------------------------------- doc / chrome
def on_cover(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(BRAND_DK)
    canvas.rect(0, 0, A4[0], A4[1], fill=1, stroke=0)
    # accent band
    canvas.setFillColor(BRAND)
    canvas.rect(0, A4[1]-300, A4[0], 300, fill=1, stroke=0)
    canvas.setFillColor(ACCENT)
    canvas.rect(0, A4[1]-305, A4[0], 5, fill=1, stroke=0)
    canvas.restoreState()

def on_page(canvas, doc):
    canvas.saveState()
    # header rule
    canvas.setStrokeColor(LINE_GREY)
    canvas.setLineWidth(0.6)
    canvas.line(20*mm, A4[1]-18*mm, A4[0]-20*mm, A4[1]-18*mm)
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#8A97A6"))
    canvas.drawString(20*mm, A4[1]-15*mm, "Signage Field Operations — Stakeholder Demo")
    canvas.drawRightString(A4[0]-20*mm, A4[1]-15*mm, "Confidential")
    # footer
    canvas.line(20*mm, 15*mm, A4[0]-20*mm, 15*mm)
    canvas.drawString(20*mm, 11*mm, "Varun Beverages Ltd. / RJ Corp")
    canvas.drawRightString(A4[0]-20*mm, 11*mm, "Page %d" % doc.page)
    canvas.restoreState()

doc = BaseDocTemplate(
    OUTPUT, pagesize=A4,
    leftMargin=20*mm, rightMargin=20*mm, topMargin=24*mm, bottomMargin=20*mm,
    title="Signage Field Operations — Stakeholder Demo",
    author="Product Team",
)
frame = Frame(doc.leftMargin, doc.bottomMargin,
              doc.width, doc.height, id="main")
cover_frame = Frame(0, 0, A4[0], A4[1], id="cover",
                    leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
doc.addPageTemplates([
    PageTemplate(id="Cover", frames=[cover_frame], onPage=on_cover),
    PageTemplate(id="Body", frames=[frame], onPage=on_page),
])

# ---------------------------------------------------------------- content
story = []
today = datetime.date.today().strftime("%d %B %Y")

# ---- COVER
story.append(Spacer(1, 175*mm))
story.append(Paragraph("Signage Field Operations", styles["CoverTitle"]))
story.append(Spacer(1, 6))
story.append(Paragraph("Demo &amp; Usage Walkthrough for Stakeholders", styles["CoverSub"]))
story.append(Spacer(1, 60))
story.append(Paragraph("Prepared for Varun Beverages Limited (RJ Corp)", styles["CoverMeta"]))
story.append(Paragraph(today, styles["CoverMeta"]))
story.append(Paragraph("Version 1.0 — Confidential", styles["CoverMeta"]))
# Switch to the Body template BEFORE breaking, so page 2 uses the light frame.
story.append(NextPageTemplate("Body"))
story.append(PageBreak())

# ---- 1. Overview
story.append(Pill("1.  What This App Does"))
story.append(Spacer(1, 8))
story.append(Paragraph(
    "The Signage Field Operations app digitises how branded signage "
    "(boardings and pamphlet drops) gets surveyed, approved, and installed "
    "across retail outlets. It replaces paper checklists and WhatsApp photos "
    "with a single, auditable system — every visit is tagged with the "
    "employee's GPS location, a live-camera photo, and a timestamp.", styles["Lead"]))
story.append(Paragraph(
    "The platform connects three groups of people: the RJ Corp head office "
    "team that plans the work, the vendor agencies that carry it out, and the "
    "field employees who physically visit each store. Work flows top-down "
    "(head office assigns to a vendor, the vendor assigns to a person) while "
    "proof and approvals flow back up.", styles["Body"]))

story.append(Paragraph("Key principles", styles["H2"]))
story.append(bullets([
    "<b>Proof of presence</b> — photos must be taken with the live "
    "camera at the store; gallery uploads are not allowed.",
    "<b>Location-stamped</b> — GPS coordinates are captured automatically "
    "at the moment each step is submitted.",
    "<b>Full audit trail</b> — every action is recorded as an "
    "append-only timeline entry that cannot be edited after the fact.",
    "<b>Head-office approval</b> — survey findings are reviewed and "
    "signed off centrally before any installation happens.",
]))

# ---- 2. Roles
story.append(Spacer(1, 6))
story.append(Pill("2.  Who Uses It — The Three Roles"))
story.append(Spacer(1, 8))
story.append(data_table(
    ["Role", "Belongs to", "What they do"],
    [
        ["RJ Corp Admin", "Head office",
         "Sets up vendors and stores, creates tasks, and reviews / approves "
         "survey findings. Sees every task across all vendors."],
        ["Vendor Admin", "Vendor agency",
         "Receives tasks assigned to their agency and re-assigns each one to "
         "one of their field employees. Sees only their agency's tasks."],
        ["Field Employee", "Vendor agency",
         "Visits the store, captures photos and GPS, records the survey or "
         "installation. Sees only the tasks assigned to them."],
    ],
    [38*mm, 32*mm, 100*mm]))

# ---- 3. The work, three task types
story.append(Spacer(1, 8))
story.append(Pill("3.  The Three Kinds of Field Work"))
story.append(Spacer(1, 8))
story.append(data_table(
    ["Task type", "Purpose", "How it ends"],
    [
        ["Recee (Survey)",
         "An employee visits a store to photograph the wall / space where a "
         "board could go and suggests a size.",
         "Goes to head office for approval. On approval, an installation task "
         "is created automatically."],
        ["Installation (after survey)",
         "Put up the board that was approved — with the brand and size "
         "already locked in by head office.",
         "Employee uploads installation photos → marked complete."],
        ["Direct Installation",
         "Pamphlet / material drop at an area with a target count — no "
         "survey needed.",
         "Employee records the actual count + pincode with photos → "
         "complete."],
    ],
    [38*mm, 66*mm, 66*mm]))

# ---- PAGE BREAK before walkthrough
story.append(PageBreak())

# ---- 4. End-to-end walkthrough
story.append(Pill("4.  End-to-End Walkthrough"))
story.append(Spacer(1, 8))
story.append(Paragraph(
    "The following sequence shows a full cycle — from head office "
    "setting up data through to a completed, approved installation on the "
    "ground.", styles["Body"]))
story.append(Spacer(1, 4))

story.append(step_block(1, "Head office sets up the basics",
    ["RJ Corp Admin switches to <b>Admin mode</b> and opens the "
     "<b>Onboarding</b> tab.",
     "<b>Onboard a vendor</b> agency (name + unique ID).",
     "<b>Add stores</b> — individually via the form, or in bulk from an "
     "Excel sheet (name, address, pincode, lat/long, store UID, contact no.)."]))

story.append(step_block(2, "Head office creates and assigns tasks",
    ["Open <b>Create Task</b>: choose <b>Recee</b> or <b>Direct "
     "Installation</b>, pick the target <b>vendor</b>, and pick the "
     "<b>store</b>.",
     "For Direct Installation, set the <b>target pamphlet count</b> and "
     "pincode.",
     "Many tasks at once? Use <b>Bulk Upload → Tasks</b> from Excel.",
     "The task is now assigned to the vendor agency, waiting for them to put "
     "a person on it."]))

story.append(step_block(3, "Vendor assigns the task to an employee",
    ["Vendor Admin opens the task and taps <b>Assign to Employee</b>.",
     "They choose any field employee in their agency — the task now "
     "appears in that person's task list."]))

story.append(step_block(4, "Employee performs the survey (Recee)",
    ["Employee opens the task, sees the <b>store name, address, pincode, "
     "UID and contact number</b>, and taps <b>Start Recee</b>.",
     "They take <b>multiple live photos</b> of the space and can <b>mark on "
     "the photo</b> exactly where the board should be placed.",
     "They suggest a board size; GPS and time are captured automatically on "
     "submit."]))

story.append(step_block(5, "Head office reviews and approves",
    ["RJ Corp Admin sees the submitted survey, with all photos and markers.",
     "They <b>set the brand</b> and confirm or override the board size, then "
     "<b>Approve</b> (or Reject with a reason).",
     "On approval an <b>Installation task is auto-created</b> for the same "
     "store, with brand &amp; size locked — ready for the vendor to "
     "assign."]))

story.append(step_block(6, "Installation and completion",
    ["The vendor assigns the installation task (can be a different "
     "employee).",
     "That employee installs the board, takes proof photos, and submits.",
     "The task is marked <b>Completed</b> — the full history stays "
     "visible on the task's timeline."]))

# ---- 5. What a stakeholder sees / value
story.append(PageBreak())
story.append(Pill("5.  What You Can See &amp; Track"))
story.append(Spacer(1, 8))
story.append(Paragraph(
    "Every task carries a complete, tamper-evident timeline. Opening any task "
    "shows the store details and each step in order — who did it, when, "
    "where (GPS), and the photos they captured.", styles["Body"]))
story.append(bullets([
    "<b>Store information</b> on the task itself — name, address, "
    "pincode, store UID and contact number.",
    "<b>Survey evidence</b> — multiple geo-tagged photos with placement "
    "markers.",
    "<b>Approval record</b> — who approved, the chosen brand and size, "
    "or the rejection reason.",
    "<b>Installation proof</b> — photos and location confirming the "
    "board went up.",
    "<b>Pamphlet results</b> — target vs. actual count and pincode for "
    "direct-installation work.",
]))

story.append(Spacer(1, 6))
story.append(Paragraph("Business value at a glance", styles["H2"]))
story.append(data_table(
    ["Before", "With this app"],
    [
        ["Photos over WhatsApp, easy to fake or reuse",
         "Live-camera only, GPS + time stamped at the store"],
        ["Approvals over calls and messages",
         "Central approval with brand &amp; size locked on record"],
        ["No reliable history of who did what",
         "Append-only audit timeline per task"],
        ["Manual tracking in spreadsheets",
         "Bulk upload of stores &amp; tasks, live status per task"],
    ],
    [85*mm, 85*mm]))

story.append(Spacer(1, 14))
story.append(HRFlowable(width="100%", thickness=0.8, color=LINE_GREY))
story.append(Spacer(1, 6))
story.append(Paragraph(
    "This document describes the current build of the Signage Field "
    "Operations app prepared for demonstration to VBL stakeholders. "
    "Screens and flows shown are live in the application.", styles["Small"]))

doc.build(story)
print("WROTE", OUTPUT)
