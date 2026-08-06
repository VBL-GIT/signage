# -*- coding: utf-8 -*-
"""Generate Excel templates for the three bulk-upload features (users, stores, tasks)."""
import os
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

OUT = os.path.dirname(os.path.abspath(__file__))

HEADER_FILL = PatternFill("solid", start_color="0B5394")
HEADER_FONT = Font(name="Arial", bold=True, color="FFFFFF", size=11)
CELL_FONT = Font(name="Arial", size=10)
NOTE_FONT = Font(name="Arial", size=9, italic=True, color="666666")
THIN = Side(style="thin", color="C9D4E0")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)


def build(filename, headers, rows, notes):
    wb = Workbook()
    ws = wb.active
    ws.title = "Template"

    # header row
    ws.append(headers)
    for c in range(1, len(headers) + 1):
        cell = ws.cell(row=1, column=c)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = BORDER

    # sample rows
    for r in rows:
        ws.append(r)
    for ri in range(2, 2 + len(rows)):
        for ci in range(1, len(headers) + 1):
            cell = ws.cell(row=ri, column=ci)
            cell.font = CELL_FONT
            cell.border = BORDER
            cell.alignment = Alignment(vertical="center")

    # column widths
    for ci, h in enumerate(headers, start=1):
        maxlen = max([len(str(h))] + [len(str(row[ci - 1])) if ci - 1 < len(row) else 0 for row in rows])
        ws.column_dimensions[ws.cell(row=1, column=ci).column_letter].width = min(max(maxlen + 3, 12), 40)

    ws.freeze_panes = "A2"

    # Instructions on a SEPARATE sheet — the API only ever reads the first sheet,
    # so notes here can never be mistaken for data rows.
    info = wb.create_sheet("Instructions")
    info.column_dimensions["A"].width = 100
    title = info.cell(row=1, column=1, value="How to use this template")
    title.font = Font(name="Arial", bold=True, size=12, color="0B5394")
    intro = info.cell(row=2, column=1,
                      value="Replace the sample rows on the 'Template' sheet with your own data, then upload that file. "
                            "Keep the header row exactly as-is. This sheet is ignored by the importer.")
    intro.font = NOTE_FONT
    for i, note in enumerate(notes, start=4):
        c = info.cell(row=i, column=1, value=note)
        c.font = NOTE_FONT
        c.alignment = Alignment(wrap_text=True, vertical="top")

    path = os.path.join(OUT, filename)
    wb.save(path)
    print("WROTE", path)


# ---------------------------------------------------------------- VENDORS
build(
    "bulk_vendors_template.xlsx",
    ["name", "contact_person", "contact_phone", "contact_email"],
    [
        ["Bright Signs Pvt Ltd", "Suresh Iyer", "9810000001", "suresh@brightsigns.com"],
        ["Metro Outdoor Media", "Kavita Joshi", "9810000002", "kavita@metrooutdoor.com"],
    ],
    [
        "name is REQUIRED. contact_person, contact_phone, contact_email are optional.",
        "The vendor UID is auto-generated (VND-NNN) — do NOT provide one.",
        "Endpoint: Bulk Upload -> Vendors (rjcorp_admin only).",
    ],
)

# ---------------------------------------------------------------- USERS
build(
    "bulk_users_template.xlsx",
    ["first_name", "last_name", "email", "role", "mobile", "password", "vendor_uid"],
    [
        ["Ravi", "Kumar", "ravi.kumar@example.com", "employee", "9876500001", "", "VND-001"],
        ["Sunita", "Sharma", "sunita.sharma@example.com", "vendor_user", "9876500002", "", "VND-001"],
        ["Amit", "Patel", "amit.patel@example.com", "vendor_admin", "9876500003", "Secret@123", "VND-001"],
        ["Neha", "Gupta", "neha.gupta@example.com", "rjcorp_user", "9876500004", "", ""],
    ],
    [
        "role must be one of: rjcorp_admin, rjcorp_user, vendor_admin, vendor_user, employee",
        "vendor_uid is REQUIRED for vendor_admin, vendor_user and employee; leave BLANK for rjcorp_admin / rjcorp_user.",
        "vendor_uid must match an existing vendor's UID (e.g. VND-001).",
        "password is OPTIONAL — if blank, the account defaults to 'password123'.",
        "email must be unique; duplicate emails are reported as failed rows.",
        "Endpoint: Bulk Upload -> Users (rjcorp_admin or vendor_admin).",
    ],
)

# ---------------------------------------------------------------- STORES
build(
    "bulk_stores_template.xlsx",
    ["name", "address", "pincode", "lat", "long", "uid", "contact_no", "vendor_uid"],
    [
        ["Store Delta", "12 MG Road, Bengaluru", "560001", 12.9716, 77.5946, "STR-004", "9876510004", "VND-001"],
        ["Store Epsilon", "45 Park Street, Kolkata", "700016", 22.5536, 88.3520, "STR-005", "9876510005", "VND-001"],
        ["Store Zeta", "8 Marine Drive, Mumbai", "400020", 18.9430, 72.8230, "", "", "VND-002"],
    ],
    [
        "name, address, pincode, lat and long are REQUIRED.",
        "lat and long must be numbers (decimal degrees).",
        "uid (store code), contact_no and vendor_uid are OPTIONAL.",
        "vendor_uid maps the store to a vendor (e.g. VND-001) — needed for store-based task creation.",
        "uid must be unique if provided; duplicates are reported as failed rows.",
        "Endpoint: Bulk Upload -> Stores (rjcorp_admin only).",
    ],
)

# ---------------------------------------------------------------- TASKS
build(
    "bulk_tasks_template.xlsx",
    ["task_type", "installation_type", "vendor_uid", "store_name", "pincode",
     "target_pamphlet_count", "brand_name", "boarding_size_label"],
    [
        ["recee", "", "VND-001", "Store Alpha", "", "", "", ""],
        ["installation", "direct", "VND-001", "Store Beta", "560034", 200, "", ""],
        ["installation", "direct_boarding", "VND-001", "Store Gamma", "", "", "BrandX", "Small (2x1.5 ft)"],
    ],
    [
        "task_type must be 'recee' or 'installation'.",
        "installation_type is REQUIRED when task_type='installation':",
        "   - 'direct'          = pamphlet distribution (use target_pamphlet_count).",
        "   - 'direct_boarding' = board install with no prior recee (brand/size optional).",
        "   (post_recee installation tasks are created automatically when a recee is approved — do NOT add them here.)",
        "vendor_uid is REQUIRED and must match an existing vendor (e.g. VND-001).",
        "store_name is REQUIRED for 'recee' and 'direct_boarding'; it must match an existing store name.",
        "target_pamphlet_count applies only to 'direct' (pamphlet) rows.",
        "brand_name + boarding_size_label are OPTIONAL and apply only to 'direct_boarding' rows;",
        "   if given they must match an existing brand / board size label.",
        "All new tasks are created UNASSIGNED — the vendor then assigns them to an employee in-app.",
        "Endpoint: Bulk Upload -> Tasks (rjcorp_admin only).",
    ],
)
