-- Demo-only: give the seeded stores contact person / phone / email so the
-- task page shows the Store Contact card. Safe to run repeatedly.
UPDATE stores SET contact_person = 'Rahul Verma',  contact_no = '9820000001', contact_email = 'alpha.store@vbl-demo.com' WHERE name = 'Store Alpha';
UPDATE stores SET contact_person = 'Priya Sen',    contact_no = '9820000002', contact_email = 'beta.store@vbl-demo.com'  WHERE name = 'Store Beta';
UPDATE stores SET contact_person = 'Imran Khan',   contact_no = '9820000003', contact_email = 'gamma.store@vbl-demo.com' WHERE name = 'Store Gamma';

-- Fill contact person/email for the bulk-demo VBL outlets too (phone already set).
UPDATE stores SET contact_email = 'andheri@vbl-demo.com',      contact_person = 'Store Manager' WHERE name = 'VBL Outlet Andheri'      AND contact_email IS NULL;
UPDATE stores SET contact_email = 'cp@vbl-demo.com',           contact_person = 'Store Manager' WHERE name = 'VBL Outlet CP'           AND contact_email IS NULL;
UPDATE stores SET contact_email = 'koramangala@vbl-demo.com',  contact_person = 'Store Manager' WHERE name = 'VBL Outlet Koramangala'  AND contact_email IS NULL;
UPDATE stores SET contact_email = 'banjarahills@vbl-demo.com', contact_person = 'Store Manager' WHERE name = 'VBL Outlet Banjara Hills' AND contact_email IS NULL;
UPDATE stores SET contact_email = 'saltlake@vbl-demo.com',     contact_person = 'Store Manager' WHERE name = 'VBL Outlet Salt Lake'     AND contact_email IS NULL;
UPDATE stores SET contact_email = 'aundh@vbl-demo.com',        contact_person = 'Store Manager' WHERE name = 'VBL Outlet Aundh'         AND contact_email IS NULL;
