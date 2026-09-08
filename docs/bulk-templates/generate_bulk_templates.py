"""Generates blank templates + filled samples for all 4 bulk-upload types.
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
        ("name", True, "Vendor / company name."),
        ("contact_person", False, "Primary contact person."),
        ("contact_phone", False, "Contact phone number."),
        ("contact_email", False, "Vendor email address."),
    ],
    # Customer Code is the business key: a row whose customer_code already
    # exists UPDATES that store in place (same store record, so its existing
    # tasks stay attached); a new customer_code creates one. vendor_uid is
    # deliberately NOT a column — a store's vendor mapping is managed
    # separately and is never changed by a store upload.
    "stores": [
        ("customer_code", True, "Customer Code — the key that decides update vs. create. Must be unique."),
        ("uid", True, "Store UID. Mandatory, and unique across all stores."),
        ("name", True, "Store name."),
        ("address", True, "Full store address."),
        ("pincode", True, "PIN code."),
        ("lat", True, "Latitude (decimal), between -90 and 90."),
        ("long", True, "Longitude (decimal), between -180 and 180."),
        ("contact_no", True, "Store contact phone."),
        ("contact_email", True, "Store contact email. Must be a valid address."),
        ("contact_person", True, "Store contact person."),
        ("outlet_status", False, "Outlet status from the customer master, e.g. ACTIVE."),
    ],
    # The customer-master ("speed dump") export, used as-is. Column names and
    # order match that export exactly, so a file can be pasted in unchanged.
    # Columns with no field of their own (hos, state cd, CHANNEL, SUB_CHANNEL)
    # are still imported: the whole row is kept verbatim in source_metadata.
    "stores_customer_master": [
        ("hos", False, "Head of sales / territory owner. Kept as source data; no field of its own."),
        ("state cd", False, "State code. Kept as source data; no field of its own."),
        ("CUST_CD", True, "Customer Code — the key that decides update vs. create. An existing code updates that store in place and its tasks stay attached; a new code creates one. Must be unique."),
        ("CUST_NAME", True, "Store name."),
        ("CONT_PR", False, "Contact person at the outlet."),
        ("MOBILE_NO", False, "Contact phone at the outlet."),
        ("ADDR_1", True, "Address line 1. At least one ADDR_ line must have a real value."),
        ("ADDR_2", False, "Address line 2."),
        ("ADDR_3", False, "Address line 3."),
        ("ADDR_4", False, "Address line 4."),
        ("ADDR_5", False, "Address line 5. ADDR_1-ADDR_5 are joined into one address; blanks, '-' and 'NA' are dropped, and repeated lines are not duplicated."),
        ("ADDR_POSTAL", True, "PIN code."),
        ("CHANNEL", False, "Sales channel. Kept as source data; no field of its own."),
        ("SUB_CHANNEL", False, "Sales sub-channel. Kept as source data; no field of its own."),
        ("LATITUDE", True, "Latitude (decimal), between -90 and 90."),
        ("LONGITUDE", True, "Longitude (decimal), between -180 and 180."),
        ("CUST_STATUS", False, "Outlet status, e.g. ACTIVE. Stored as the store's outlet status."),
    ],
    "users": [
        ("first_name", True, "Given name."),
        ("last_name", True, "Family name."),
        ("email", True, "Login email (unique)."),
        ("role", True, "employee | vendor_admin | vendor_user | rjcorp_admin | rjcorp_user."),
        ("mobile", False, "Mobile number."),
        ("vendor_uid", False, "Required for employee/vendor roles. Must exist, e.g. VND-001."),
    ],
    # Tasks are split by type — one template per task type. The task type is fixed
    # by which template you use, so no task_type / installation_type columns.
    "tasks_recee": [
        ("vendor_uid", True, "Vendor the task is for (must exist), e.g. VND-001."),
        ("store_uid", True, "Mandatory. Store the recee is for (must exist), e.g. ST-001."),
    ],
    # Pamphlet distribution is area-based, so this is the one task template
    # where store_uid stays optional — the work is located by pincode/area and
    # may not correspond to a single physical store.
    "tasks_direct": [
        ("vendor_uid", True, "Vendor the task is for (must exist), e.g. VND-001."),
        ("store_uid", False, "Optional for pamphlet distribution — this task can be area/pincode based. If given, the store must exist, e.g. ST-001."),
        ("pincode", False, "Area PIN for the pamphlet distribution."),
        ("target_pamphlet_count", False, "Target number of pamphlets to distribute."),
    ],
    "tasks_boarding": [
        ("vendor_uid", True, "Vendor the task is for (must exist), e.g. VND-001."),
        ("store_uid", True, "Mandatory. Store the installation is for (must exist), e.g. ST-001."),
        ("brand_name", False, "Must match an existing brand."),
        ("artwork_name", False, "Artwork name / code. Must be an artwork of that brand."),
        ("width_in", False, "Board width in inches (e.g. 48). Pair with height_in."),
        ("height_in", False, "Board height in inches (e.g. 36). Pair with width_in."),
    ],
}

# Columns with a fixed set of allowed values -> rendered as an Excel dropdown.
# (vendor_uid / brand_name / artwork_name reference live data, so they can't be
# a static list.)
CATEGORICAL = {
    "users": {
        "role": ["employee", "vendor_admin", "vendor_user", "rjcorp_admin", "rjcorp_user"],
    },
    # Task templates are type-specific (no task_type / installation_type columns),
    # so they have no categorical dropdowns.
}

SAMPLES = {
    "vendors": [
        ["Sunrise Signage Pvt Ltd", "Ankit Verma", "9800000001", "ankit@sunrise.example"],
        ["Skyline Boards", "Rhea Kapoor", "9800000002", "rhea@skyline.example"],
        ["Metro Ads Co", "", "", "contact@metroads.example"],
        ["Bright Outdoor Media", "Faisal Ahmed", "9800000004", "faisal@brightoutdoor.example"],
        ["Prime Display Solutions", "Neha Bansal", "9800000005", "neha@primedisplay.example"],
        ["Coastal Signage Works", "", "9800000006", ""],
    ],
    # customer_code, uid, name, address, pincode, lat, long,
    # contact_no, contact_email, contact_person, outlet_status
    "stores": [
        ["YG000000026", "ST-101", "VBL Store - Andheri", "Plot 4, Andheri East", "400069", 19.1197, 72.8468, "02233440001", "andheri@vbl.example", "Store Mgr A", "ACTIVE"],
        ["YG000000033", "ST-102", "VBL Store - Salt Lake", "Sector V, Salt Lake", "700091", 22.5697, 88.4336, "03344550002", "saltlake@vbl.example", "Store Mgr B", "ACTIVE"],
        ["YG000000037", "ST-103", "VBL Store - Koramangala", "80 Ft Road, Koramangala", "560095", 12.9352, 77.6245, "08044550003", "koramangala@vbl.example", "Store Mgr C", "ACTIVE"],
        ["YG000000038", "ST-104", "VBL Store - Hitech City", "Cyber Towers, Madhapur", "500081", 17.4483, 78.3915, "04044550004", "hitechcity@vbl.example", "Store Mgr D", "ACTIVE"],
        ["YG000101108", "ST-105", "VBL Store - Vaishali Nagar", "Vaishali Nagar Main Rd", "302021", 26.9124, 75.7305, "01414550005", "vaishali@vbl.example", "Store Mgr E", "ACTIVE"],
        ["YG000101109", "ST-106", "VBL Store - Anna Nagar", "2nd Ave, Anna Nagar", "600040", 13.0850, 80.2101, "04444550006", "annanagar@vbl.example", "Store Mgr F", "ACTIVE"],
    ],
    # hos, state cd, CUST_CD, CUST_NAME, CONT_PR, MOBILE_NO, ADDR_1..ADDR_5,
    # ADDR_POSTAL, CHANNEL, SUB_CHANNEL, LATITUDE, LONGITUDE, CUST_STATUS.
    # Row 3 shows the "-" and "NA" address placeholders being dropped, and
    # row 5 a repeated address line collapsing to one.
    "stores_customer_master": [
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
    "users": [
        ["Ramesh", "Yadav", "ramesh.yadav@vendor.example", "employee", "9811110001", "VND-001"],
        ["Sunita", "Rao", "sunita.rao@vendor.example", "employee", "9811110002", "VND-001"],
        ["Deepak", "Nair", "deepak.nair@vendor.example", "vendor_admin", "9811110003", "VND-001"],
        ["Priya", "Menon", "priya.menon@vendor.example", "employee", "9811110004", "VND-002"],
        ["Arjun", "Singh", "arjun.singh@vendor.example", "vendor_user", "9811110005", "VND-002"],
        ["Kavya", "Reddy", "kavya.reddy@rjcorp.example", "rjcorp_user", "9811110006", ""],
    ],
    "tasks_recee": [
        ["VND-001", "ST-101"],
        ["VND-001", "ST-106"],
        ["VND-002", "ST-104"],
        ["VND-001", "ST-102"],
        ["VND-002", "ST-105"],
        ["VND-001", "ST-103"],
    ],
    "tasks_direct": [
        ["VND-001", "", "400001", 250],
        ["VND-002", "", "500081", 150],
        ["VND-001", "ST-101", "400069", 300],
        ["VND-002", "", "302021", 200],
        ["VND-001", "", "600040", 175],
        ["VND-002", "ST-104", "500081", 120],
    ],
    "tasks_boarding": [
        ["VND-001", "ST-101", "BrandX", "BrandX-Festive-2026", 48, 36],
        ["VND-001", "ST-102", "BrandX", "", 60, 40],
        ["VND-002", "ST-104", "", "", "", ""],
        ["VND-001", "ST-103", "BrandX", "", 36, 24],
        ["VND-002", "ST-105", "", "", 72, 48],
        ["VND-001", "ST-106", "BrandX", "BrandX-Festive-2026", 48, 36],
    ],
}


def autosize(ws):
    for col in ws.columns:
        width = max((len(str(c.value)) for c in col if c.value is not None), default=10)
        ws.column_dimensions[col[0].column_letter].width = min(max(width + 2, 12), 45)


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


def guide_sheet(wb, spec):
    ws = wb.create_sheet("Guide")
    heads = ["Column", "Required", "Notes"]
    for ci, h in enumerate(heads, start=1):
        c = ws.cell(row=1, column=ci, value=h); c.font = HEAD_FONT; c.fill = HEAD_FILL
    for ri, (col, req, note) in enumerate(spec, start=2):
        ws.cell(row=ri, column=1, value=col).font = Font(bold=True)
        ws.cell(row=ri, column=2, value="Required" if req else "Optional")
        ws.cell(row=ri, column=3, value=note)
    autosize(ws)


def add_dropdowns(ws, spec, kind):
    """Attach list-type data validation to categorical columns so Excel shows a
    dropdown arrow and rejects free-typed values that aren't in the list."""
    cats = CATEGORICAL.get(kind)
    if not cats:
        return
    col_index = {col: ci for ci, (col, _req, _note) in enumerate(spec, start=1)}
    for col, options in cats.items():
        letter = get_column_letter(col_index[col])
        dv = DataValidation(
            type="list",
            formula1='"%s"' % ",".join(options),
            allow_blank=True,
            showErrorMessage=True,
            showInputMessage=True,
        )
        dv.errorTitle = "Invalid value"
        dv.error = "Pick one of: " + ", ".join(options)
        dv.promptTitle = col
        dv.prompt = "Choose: " + ", ".join(options)
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
    order = ["vendors", "stores", "stores_customer_master", "users",
             "tasks_recee", "tasks_direct", "tasks_boarding"]
    for kind in order:
        build(kind, SPECS[kind], SAMPLES[kind], out_dir)
    print("Done ->", out_dir)
