"""Generates blank templates + filled samples for all bulk-upload types.

Every header is ALL-CAPS, matching the column names the console shows and the
importer reports errors by. The casing is a convention, not a rule: the importer
matches a header on its spelling alone (see CASE_RULE below, which every Guide
sheet carries), so a sheet filled in with Caps Lock on imports the same way.

Run: python docs/bulk-templates/generate_bulk_templates.py
Outputs (in this folder): <type>_template.xlsx and <type>_sample.xlsx
Each workbook has a 'Data' sheet (headers, or headers+samples) and a 'Guide' sheet.
"""
import os
import sys
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

HERE = os.path.dirname(os.path.abspath(__file__))

HEAD_FILL = PatternFill("solid", fgColor="0B5CAD")
HEAD_FONT = Font(bold=True, color="FFFFFF")
REQ_FILL = PatternFill("solid", fgColor="FDECEA")   # required cols tinted
THIN = Side(style="thin", color="CBD5E1")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

# spec: (column, required?, note)
SPECS = {
    "vendors": [
        ("COMPANY_NAME", True, "Company name. Must be unique — an existing name is rejected rather than creating a second, indistinguishable vendor."),
        ("CONTACT_PERSON", True, "Primary contact person."),
        ("CONTACT_PHONE", True, "Contact phone number."),
        ("CONTACT_EMAIL", True, "Vendor email address. Optional, but must be valid and unique when given."),
        ("REMARKS", True, "Free-text note about this vendor. Not used in any business rule; up to 2000 characters."),
    ],
    # The customer-master ("speed dump") export, used as-is: one store template,
    # with the export's own column names and order so a file can be pasted in
    # unchanged. Header matching is case- and punctuation-insensitive at import,
    # so CUST_CD / Cust_CD / "cust cd" all work. Columns with no field of their
    # own (HOS, State_CD, CHANNEL, SUB_CHANNEL) are still imported: the whole
    # row is kept verbatim in stores.source_metadata.
    "stores": [
        ("HOS", True, "Head of sales / territory owner. Kept as source data; no field of its own."),
        ("STATE_CD", True, "State code. Kept as source data; no field of its own."),
        ("CUST_CD", True, "Customer Code — the store's identifier and the key that decides update vs. create. An existing code updates that store in place and its tasks stay attached; a new code creates one. Must be unique."),
        ("CUST_NAME", True, "Store name."),
        ("CONT_PR", True, "Contact person at the outlet."),
        ("MOBILE_NO", True, "Contact phone at the outlet."),
        ("ADDR_1", True, "Address line 1. At least one ADDR_ line must have a real value."),
        ("ADDR_2", False, "Address line 2."),
        ("ADDR_3", False, "Address line 3."),
        ("ADDR_4", False, "Address line 4."),
        ("ADDR_5", False, "Address line 5. ADDR_1-ADDR_5 are joined into one address; blanks, '-' and 'NA' are dropped, and repeated lines are not duplicated."),
        ("ADDR_POSTAL", True, "PIN code."),
        ("CHANNEL", True, "Sales channel. Kept as source data; no field of its own."),
        ("SUB_CHANNEL", True, "Sales sub-channel. Kept as source data; no field of its own."),
        ("LATITUDE", True, "Latitude (decimal), between -90 and 90. A file spelling this LATTITUDE is also accepted."),
        ("LONGITUDE", True, "Longitude (decimal), between -180 and 180."),
        ("CUST_STATUS", True, "Outlet status, e.g. ACTIVE. A store already marked INACTIVE/Closed is frozen: its row is rejected rather than updated, unless this row sets the status back to ACTIVE."),
    ],
    "employees": [
        ("FIRST_NAME", True, "Given name."),
        ("LAST_NAME", True, "Family name."),
        ("EMAIL", True, "Login email (unique)."),
        ("ROLE", True, "employee | vendor_admin | vendor_user | rjcorp_admin | rjcorp_user. Matched on spelling only, so EMPLOYEE and Employee are equally valid."),
        ("MOBILE", True, "Mobile number."),
        ("VENDOR_UID", True, "Vendor the account belongs to. Must exist, e.g. VND-001. RJCorp accounts belong to no vendor and cannot be created from this template — use Onboarding > Employee for those."),
    ],
    # Tasks are split by type — one template per task type. The task type is fixed
    # by which template you use, so no task_type / installation_type columns.
    "tasks_recee": [
        ("VENDOR_UID", True, "Vendor the task is for (must exist), e.g. VND-001."),
        ("CUSTOMER_CODE", True, "Mandatory. Customer Code of the store the recee is for (must exist)."),
    ],
    # Pamphlet distribution is area-based, so this is the one task template
    # where store_uid stays optional — the work is located by pincode/area and
    # may not correspond to a single physical store.
    "tasks_direct": [
        ("VENDOR_UID", True, "Vendor the task is for (must exist), e.g. VND-001."),
        ("CUSTOMER_CODE", False, "Optional for pamphlet distribution — this task can be area/pincode based. If given, the Customer Code must match an existing store."),
        ("PINCODE", True, "Area PIN for the pamphlet distribution."),
        ("TARGET_PAMPHLET_COUNT", True, "Target number of pamphlets to distribute."),
    ],
    "tasks_boarding": [
        ("VENDOR_UID", True, "Vendor the task is for (must exist), e.g. VND-001."),
        ("CUSTOMER_CODE", True, "Mandatory. Customer Code of the store the installation is for (must exist)."),
        ("BRAND_NAME", False, "Must match a brand that already exists in the system (Manage > Brands). Left blank in the sample because brand names differ per system."),
        ("ARTWORK_NAME", False, "Artwork name / code. Must be an artwork of that brand."),
        ("WIDTH_IN", False, "Board width in inches (e.g. 48). Pair with height_in."),
        ("HEIGHT_IN", False, "Board height in inches (e.g. 36). Pair with width_in."),
    ],
}

# Columns with a fixed set of allowed values -> rendered as an Excel dropdown.
# (vendor_uid / brand_name / artwork_name reference live data, so they can't be
# a static list.)
CATEGORICAL = {
    "employees": {
        "ROLE": ["employee", "vendor_admin", "vendor_user", "rjcorp_admin", "rjcorp_user"],
    },
    # Task templates are type-specific (no task_type / installation_type columns),
    # so they have no categorical dropdowns.
}

SAMPLES = {
    # Every column is required, so no sample cell is left blank.
    "vendors": [
        ["Sunrise Signage Pvt Ltd", "Ankit Verma", "9800000001", "ankit@sunrise.example", "Preferred vendor for West zone"],
        ["Skyline Boards", "Rhea Kapoor", "9800000002", "rhea@skyline.example", "Boarding installs only"],
        ["Metro Ads Co", "Imran Shaikh", "9800000003", "contact@metroads.example", "Onboarded Aug 2026"],
        ["Bright Outdoor Media", "Faisal Ahmed", "9800000004", "faisal@brightoutdoor.example", "Covers North zone"],
        ["Prime Display Solutions", "Neha Bansal", "9800000005", "neha@primedisplay.example", "Handles boarding installs only"],
        ["Coastal Signage Works", "Divya Nair", "9800000006", "divya@coastalsignage.example", "Coastal belt only"],
    ],
    # hos, state cd, CUST_CD, CUST_NAME, CONT_PR, MOBILE_NO, ADDR_1..ADDR_5,
    # ADDR_POSTAL, CHANNEL, SUB_CHANNEL, LATITUDE, LONGITUDE, CUST_STATUS.
    # Row 3 shows the "-" and "NA" address placeholders being dropped, and
    # row 5 a repeated address line collapsing to one.
    "stores": [
        ["Rajesh Kumar", "MH", "YG000000026", "VBL Store - Andheri", "Store Mgr A", "02233440001",
         "Plot 4", "Andheri East", "Mumbai", "", "", "400069", "GT", "Grocery", 19.1197, 72.8468, "ACTIVE"],
        ["Rajesh Kumar", "MH", "YG000000033", "VBL Store - Powai", "Store Mgr B", "02233440002",
         "Hiranandani Gardens", "Powai", "Mumbai", "", "", "400076", "GT", "Convenience", 19.1176, 72.9060, "ACTIVE"],
        ["Anita Sharma", "WB", "YG000000037", "VBL Store - Salt Lake", "Store Mgr C", "03344550003",
         "Sector V", "-", "Salt Lake", "NA", "", "700091", "MT", "Supermarket", 22.5697, 88.4336, "ACTIVE"],
        ["Vikram Patel", "KA", "YG000000038", "VBL Store - Koramangala", "Store Mgr D", "08044550004",
         "80 Ft Road", "Koramangala", "Bengaluru", "", "", "560095", "GT", "Grocery", 12.9352, 77.6245, "ACTIVE"],
        ["Vikram Patel", "TS", "YG000101108", "VBL Store - Hitech City", "Store Mgr E", "04044550005",
         "Cyber Towers", "Cyber Towers", "Madhapur", "Hyderabad", "", "500081", "MT", "Supermarket", 17.4483, 78.3915, "ACTIVE"],
        ["Anita Sharma", "TN", "YG000101109", "VBL Store - Anna Nagar", "Store Mgr F", "04444550006",
         "2nd Avenue", "Anna Nagar", "Chennai", "", "", "600040", "GT", "Convenience", 13.0850, 80.2101, "INACTIVE"],
    ],
    # No password column: each account's initial password is generated by the
    # server and emailed to its owner.
    "employees": [
        ["Ramesh", "Yadav", "ramesh.yadav@vendor.example", "employee", "9811110001", "VND-001"],
        ["Sunita", "Rao", "sunita.rao@vendor.example", "employee", "9811110002", "VND-001"],
        ["Deepak", "Nair", "deepak.nair@vendor.example", "vendor_admin", "9811110003", "VND-001"],
        ["Priya", "Menon", "priya.menon@vendor.example", "employee", "9811110004", "VND-002"],
        ["Arjun", "Singh", "arjun.singh@vendor.example", "vendor_user", "9811110005", "VND-002"],
        ["Kavya", "Reddy", "kavya.reddy@vendor.example", "vendor_user", "9811110006", "VND-002"],
    ],
    "tasks_recee": [
        ["VND-001", "YG000000026"],
        ["VND-001", "YG000101109"],
        ["VND-002", "YG000000038"],
        ["VND-001", "YG000000033"],
        ["VND-002", "YG000101108"],
        ["VND-001", "YG000000037"],
    ],
    "tasks_direct": [
        ["VND-001", "", "400001", 250],
        ["VND-002", "", "500081", 150],
        ["VND-001", "YG000000026", "400069", 300],
        ["VND-002", "", "302021", 200],
        ["VND-001", "", "600040", 175],
        ["VND-002", "YG000000038", "500081", 120],
    ],
    # BRAND_NAME / ARTWORK_NAME are left blank on purpose. They must match a
    # brand that already exists in YOUR system, and a sample naming an invented
    # one ("BrandX") fails to import everywhere — which is worse than a sample
    # that shows the shape and imports cleanly. The Guide sheet explains what
    # goes in them.
    "tasks_boarding": [
        ["VND-001", "YG000000026", "", "", 48, 36],
        ["VND-001", "YG000000033", "", "", 60, 40],
        ["VND-002", "YG000000038", "", "", "", ""],
        ["VND-001", "YG000000037", "", "", 36, 24],
        ["VND-002", "YG000101108", "", "", 72, 48],
        ["VND-001", "YG000101109", "", "", 48, 36],
    ],
}


def autosize(ws):
    """Width each column to its longest value.

    Indexed by column NUMBER rather than through col[0].column_letter: the Guide
    sheet merges its first row for the case-rule banner, and a MergedCell has no
    column_letter at all.
    """
    for ci in range(1, ws.max_column + 1):
        letter = get_column_letter(ci)
        width = max(
            (len(str(c.value)) for c in ws[letter] if c.value is not None),
            default=10,
        )
        ws.column_dimensions[letter].width = min(max(width + 2, 12), 45)


def header_row(ws, spec):
    for ci, (col, req, _note) in enumerate(spec, start=1):
        c = ws.cell(row=1, column=ci, value=col)
        c.font = HEAD_FONT
        c.fill = HEAD_FILL
        c.alignment = Alignment(horizontal="center")
        c.border = BORDER
        if req:
            note = ws.cell(row=2, column=ci)  # placeholder to tint later if needed
    ws.freeze_panes = "A2"


# Stated on every Guide sheet. The importer matches a header on its SPELLING
# alone, so the all-caps headers below are a convention, not a requirement.
CASE_RULE = (
    "Column names are matched on SPELLING ONLY. Upper or lower case makes no difference, "
    "and spaces, hyphens and underscores are treated the same - so CUST_CD, Cust_CD and "
    "\"cust cd\" are the same column. The headers on the Data sheet are all-caps; keep the "
    "wording, and the case is up to you. A sheet filled in with Caps Lock on uploads exactly "
    "like any other. Do not rename, reorder or delete columns - only the wording identifies them."
)


def guide_sheet(wb, spec):
    ws = wb.create_sheet("Guide")
    # Row 1 is the rule that applies to every column, before the per-column table.
    rule = ws.cell(row=1, column=1, value=CASE_RULE)
    rule.font = Font(bold=True)
    rule.alignment = Alignment(wrap_text=True, vertical="top")
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=3)
    ws.row_dimensions[1].height = 60
    heads = ["Column", "Required", "Notes"]
    for ci, h in enumerate(heads, start=1):
        c = ws.cell(row=2, column=ci, value=h); c.font = HEAD_FONT; c.fill = HEAD_FILL
    for ri, (col, req, note) in enumerate(spec, start=3):
        ws.cell(row=ri, column=1, value=col).font = Font(bold=True)
        ws.cell(row=ri, column=2, value="Required" if req else "Optional")
        ws.cell(row=ri, column=3, value=note)
    autosize(ws)
    # autosize measures the merged rule text too, which would blow column A out
    # to its cap; the per-column names are what the width should follow.
    ws.column_dimensions["A"].width = max(
        (len(col) for col, _r, _n in spec), default=10
    ) + 4


def add_dropdowns(ws, spec, kind):
    """Attach list-type data validation to categorical columns so Excel shows a
    dropdown arrow and rejects free-typed values that aren't in the list."""
    cats = CATEGORICAL.get(kind)
    if not cats:
        return
    col_index = {col: ci for ci, (col, _req, _note) in enumerate(spec, start=1)}
    for col, options in cats.items():
        letter = get_column_letter(col_index[col])
        # showErrorMessage stays OFF on purpose: the dropdown offers the values,
        # but Excel must not REFUSE one that differs only in case. The importer
        # matches these on spelling alone (EMPLOYEE == employee), so a cell
        # typed with Caps Lock on is valid and blocking it here would be a
        # barrier the server does not have.
        dv = DataValidation(
            type="list",
            formula1='"%s"' % ",".join(options),
            allow_blank=True,
            showErrorMessage=False,
            showInputMessage=True,
        )
        dv.promptTitle = col
        dv.prompt = "Choose: " + ", ".join(options) + " (case does not matter)"
        ws.add_data_validation(dv)
        dv.add(f"{letter}2:{letter}1000")


def build(kind, spec, samples, out_dir):
    # template (headers only)
    wb = Workbook(); ws = wb.active; ws.title = "Data"
    header_row(ws, spec); add_dropdowns(ws, spec, kind); autosize(ws); guide_sheet(wb, spec)
    wb.save(os.path.join(out_dir, f"{kind}_template.xlsx"))
    # sample (headers + rows)
    wb = Workbook(); ws = wb.active; ws.title = "Data"
    header_row(ws, spec)
    for r, row in enumerate(samples, start=2):
        for c, val in enumerate(row, start=1):
            ws.cell(row=r, column=c, value=val).border = BORDER
    add_dropdowns(ws, spec, kind); autosize(ws); guide_sheet(wb, spec)
    wb.save(os.path.join(out_dir, f"{kind}_sample.xlsx"))
    print(f"  {kind}: template + sample")


if __name__ == "__main__":
    out_dir = sys.argv[1] if len(sys.argv) > 1 else HERE
    os.makedirs(out_dir, exist_ok=True)
    print("Writing bulk templates + samples:")
    order = ["vendors", "stores", "employees",
             "tasks_recee", "tasks_direct", "tasks_boarding"]
    for kind in order:
        build(kind, SPECS[kind], SAMPLES[kind], out_dir)
    print("Done ->", out_dir)
