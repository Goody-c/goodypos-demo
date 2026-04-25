/**
 * GoodyPOS Demo Seeder
 * Creates two fully-populated demo stores:
 *   1. TechHub Electronics  (GADGET / Smart Retail mode)
 *   2. FreshMart Grocery    (SUPERMARKET mode)
 * American products, names, addresses, and currency (USD).
 */
import bcrypt from 'bcryptjs';

const DEMO_PASSWORD = 'demo123';
const hash = (v: string) => bcrypt.hashSync(v, 10);
const hashPin = (p: string) => bcrypt.hashSync(p, 10);

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
};
const dateAgo = (n: number) => daysAgo(n).split('T')[0];
function rnd(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ── Smart Retail catalogue (USD cents → stored as dollars) ───────────────────
const GT_CATEGORIES = ['Smartphones', 'Laptops', 'Accessories', 'Tablets', 'Audio'];

const GT_PRODUCTS = [
  // Each product has exactly ONE condition in its matrix
  { name: 'iPhone 15 Pro Max 256GB',     category: 'Smartphones', price: 1199, cost: 950,  matrix: { new:      { stock: 8,  price: 1199 } } },
  { name: 'Samsung Galaxy S24 Ultra',    category: 'Smartphones', price: 1099, cost: 870,  matrix: { new:      { stock: 6,  price: 1099 } } },
  { name: 'Google Pixel 8 Pro',          category: 'Smartphones', price: 899,  cost: 710,  matrix: { new:      { stock: 5,  price: 899  } } },
  { name: 'MacBook Air 15" M3',          category: 'Laptops',     price: 1299, cost: 1050, matrix: { new:      { stock: 4,  price: 1299 } } },
  { name: 'Dell XPS 15 (i7, 32GB)',      category: 'Laptops',     price: 1599, cost: 1280, matrix: { new:      { stock: 3,  price: 1599 } } },
  { name: 'Lenovo ThinkPad X1 Carbon',   category: 'Laptops',     price: 1249, cost: 990,  matrix: { new:      { stock: 5,  price: 1249 } } },
  { name: 'iPad Pro 12.9" M2',           category: 'Tablets',     price: 1099, cost: 880,  matrix: { new:      { stock: 6,  price: 1099 } } },
  { name: 'Samsung Galaxy Tab S9+',      category: 'Tablets',     price: 799,  cost: 630,  matrix: { new:      { stock: 4,  price: 799  } } },
  { name: 'AirPods Pro (2nd Gen)',        category: 'Audio',       price: 249,  cost: 185,  matrix: { new:      { stock: 12, price: 249  } } },
  { name: 'Sony WH-1000XM5',             category: 'Audio',       price: 349,  cost: 265,  matrix: { new:      { stock: 8,  price: 349  } } },
  { name: 'USB-C Cable 6ft (3-Pack)',     category: 'Accessories', price: 19,   cost: 7,    stock: 60 },
  { name: 'iPhone 15 Clear Case',        category: 'Accessories', price: 29,   cost: 10,   stock: 35 },
  { name: 'Tempered Glass Screen Guard', category: 'Accessories', price: 14,   cost: 4,    stock: 80 },
  { name: 'Wireless Charging Pad 15W',   category: 'Accessories', price: 39,   cost: 18,   stock: 25 },
  { name: 'Laptop Sleeve 15"',           category: 'Accessories', price: 34,   cost: 14,   stock: 20 },
];

// ── Grocery catalogue ─────────────────────────────────────────────────────────
const SM_CATEGORIES = ['Beverages', 'Pantry', 'Household', 'Snacks', 'Personal Care', 'Dairy & Eggs', 'Frozen Foods', 'Produce'];

const SM_PRODUCTS = [
  // Beverages
  { name: 'Coca-Cola 2L',             category: 'Beverages',    price: 2.79, cost: 1.50, stock: 120 },
  { name: 'Pepsi 2L',                 category: 'Beverages',    price: 2.69, cost: 1.45, stock: 100 },
  { name: 'Gatorade Thirst Quencher', category: 'Beverages',    price: 1.99, cost: 1.10, stock: 90  },
  { name: 'Tropicana OJ 52oz',        category: 'Beverages',    price: 4.99, cost: 3.10, stock: 60  },
  { name: 'Dasani Water 24-Pack',     category: 'Beverages',    price: 5.99, cost: 3.50, stock: 80  },
  { name: 'Red Bull Energy 4-Pack',   category: 'Beverages',    price: 9.99, cost: 6.50, stock: 45  },
  // Pantry
  { name: 'Jasmine Rice 5lb',         category: 'Pantry',       price: 6.99, cost: 4.50, stock: 75  },
  { name: 'Barilla Pasta 1lb',        category: 'Pantry',       price: 1.99, cost: 1.10, stock: 100 },
  { name: 'Hunt\'s Tomato Sauce',     category: 'Pantry',       price: 1.49, cost: 0.80, stock: 120 },
  { name: 'Skippy Peanut Butter 16oz',category: 'Pantry',       price: 3.99, cost: 2.40, stock: 60  },
  { name: 'Quaker Oats 42oz',         category: 'Pantry',       price: 5.49, cost: 3.50, stock: 55  },
  { name: 'Campbell\'s Tomato Soup',  category: 'Pantry',       price: 1.39, cost: 0.75, stock: 90  },
  { name: 'Heinz Ketchup 32oz',       category: 'Pantry',       price: 3.99, cost: 2.20, stock: 70  },
  // Household
  { name: 'Tide Pods 42-Count',       category: 'Household',    price: 14.99,cost: 9.50, stock: 50  },
  { name: 'Dawn Dish Soap 28oz',      category: 'Household',    price: 3.99, cost: 2.20, stock: 65  },
  { name: 'Bounty Paper Towels 6-Pack',category:'Household',    price: 10.99,cost: 6.80, stock: 55  },
  { name: 'Charmin Ultra Soft 12-Roll',category:'Household',    price: 9.99, cost: 6.00, stock: 60  },
  { name: 'Clorox Disinfectant 32oz', category: 'Household',    price: 4.99, cost: 2.80, stock: 45  },
  // Snacks
  { name: 'Lay\'s Classic Chips 8oz', category: 'Snacks',       price: 4.49, cost: 2.60, stock: 55  },
  { name: 'Oreo Cookies 14.3oz',      category: 'Snacks',       price: 4.99, cost: 3.00, stock: 60  },
  { name: 'Planters Mixed Nuts 10oz', category: 'Snacks',       price: 5.99, cost: 3.80, stock: 40  },
  { name: 'Nature Valley Granola Bars',category:'Snacks',        price: 4.49, cost: 2.80, stock: 50  },
  // Personal Care
  { name: 'Dove Body Wash 22oz',      category: 'Personal Care',price: 6.99, cost: 4.20, stock: 45  },
  { name: 'Colgate Total Toothpaste', category: 'Personal Care',price: 4.99, cost: 2.90, stock: 55  },
  { name: 'Head & Shoulders 13.5oz',  category: 'Personal Care',price: 7.99, cost: 4.80, stock: 40  },
  { name: 'Gillette Mach3 Razors 4pk',category: 'Personal Care',price: 11.99,cost: 7.50, stock: 30  },
  // Dairy & Eggs
  { name: 'Whole Milk Gallon',        category: 'Dairy & Eggs', price: 4.29, cost: 2.70, stock: 40  },
  { name: 'Greek Yogurt 32oz',        category: 'Dairy & Eggs', price: 5.99, cost: 3.80, stock: 35  },
  { name: 'Large Eggs 1 Dozen',       category: 'Dairy & Eggs', price: 3.49, cost: 2.10, stock: 50  },
  { name: 'Kraft American Cheese 16oz',category:'Dairy & Eggs', price: 4.99, cost: 3.20, stock: 40  },
  // Frozen
  { name: 'DiGiorno Pizza (Pepperoni)',category:'Frozen Foods',  price: 8.99, cost: 5.50, stock: 30  },
  { name: 'Tyson Chicken Nuggets 5lb',category: 'Frozen Foods', price: 10.99,cost: 7.00, stock: 25  },
  { name: 'Ben & Jerry\'s Ice Cream', category: 'Frozen Foods', price: 5.99, cost: 3.80, stock: 25  },
  // Produce
  { name: 'Bananas (per bunch)',       category: 'Produce',      price: 1.49, cost: 0.70, stock: 60  },
  { name: 'Apples Gala (3lb bag)',    category: 'Produce',      price: 4.99, cost: 2.80, stock: 45  },
  { name: 'Baby Spinach 5oz',         category: 'Produce',      price: 3.99, cost: 2.20, stock: 35  },
];

// ── Customers ─────────────────────────────────────────────────────────────────
const GT_CUSTOMERS = [
  { name: 'James Carter',    phone: '(213) 555-0101', address: '1420 Sunset Blvd, Los Angeles, CA' },
  { name: 'Emily Rodriguez', phone: '(212) 555-0142', address: '305 West 54th St, New York, NY' },
  { name: 'Michael Thompson',phone: '(312) 555-0183', address: '820 N Michigan Ave, Chicago, IL' },
  { name: 'Sarah Johnson',   phone: '(713) 555-0224', address: '4501 Main St, Houston, TX' },
  { name: 'David Kim',       phone: '(415) 555-0265', address: '2100 Market St, San Francisco, CA' },
  { name: 'Jessica Williams',phone: '(404) 555-0306', address: '750 Peachtree St, Atlanta, GA' },
  { name: 'Ryan Martinez',   phone: '(602) 555-0347', address: '220 E Roosevelt St, Phoenix, AZ' },
  { name: 'Ashley Brown',    phone: '(206) 555-0388', address: '1801 Pike Pl, Seattle, WA' },
  { name: 'Brandon Lee',     phone: '(617) 555-0429', address: '99 High St, Boston, MA' },
  { name: 'Megan Davis',     phone: '(303) 555-0470', address: '1600 Glenarm Pl, Denver, CO' },
];

const SM_CUSTOMERS = [
  { name: 'Linda Harris',    phone: '(503) 555-0110', address: '412 Oak Ave, Portland, OR' },
  { name: 'Kevin Wilson',    phone: '(702) 555-0151', address: '3200 Las Vegas Blvd, Las Vegas, NV' },
  { name: 'Patricia Moore',  phone: '(612) 555-0192', address: '900 Nicollet Mall, Minneapolis, MN' },
  { name: 'Charles Jackson', phone: '(615) 555-0233', address: '1701 Broadway, Nashville, TN' },
  { name: 'Jennifer Taylor', phone: '(512) 555-0274', address: '600 Congress Ave, Austin, TX' },
  { name: 'Robert Anderson', phone: '(305) 555-0315', address: '801 Brickell Ave, Miami, FL' },
  { name: 'Nancy Thomas',    phone: '(215) 555-0356', address: '1500 Market St, Philadelphia, PA' },
  { name: 'Daniel White',    phone: '(314) 555-0397', address: '200 N Broadway, St. Louis, MO' },
];

export async function seedDemoData(pool: any): Promise<{ message: string }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      `SELECT id FROM stores WHERE name IN ('TechHub Electronics','FreshMart Grocery') LIMIT 1`,
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return { message: 'Demo data already exists. Delete the demo stores first to re-seed.' };
    }

    const pwHash = hash(DEMO_PASSWORD);

    // ═══════════════════════════════════════════════════════════════════════
    // STORE 1 — TechHub Electronics (GADGET / Smart Retail)
    // ═══════════════════════════════════════════════════════════════════════
    const gtStore = await client.query(
      `INSERT INTO stores (name,mode,receipt_paper_size,license_status,currency_code,tax_enabled,tax_percentage,address,phone)
       VALUES ('TechHub Electronics','GADGET','A4','UNLICENSED','USD',0,0,'220 5th Ave, New York, NY 10001','(212) 555-7890') RETURNING id`,
    );
    const gtId = Number(gtStore.rows[0].id);

    const gtOwner      = await client.query(`INSERT INTO users (store_id,username,password,role,pin) VALUES ($1,'demo_gt_owner',$2,'STORE_ADMIN',$3) RETURNING id`,[gtId,pwHash,hashPin('1000')]);
    const gtManager    = await client.query(`INSERT INTO users (store_id,username,password,role,pin) VALUES ($1,'demo_gt_manager',$2,'MANAGER',$3) RETURNING id`,[gtId,pwHash,hashPin('1234')]);
    const gtCashier    = await client.query(`INSERT INTO users (store_id,username,password,role,pin) VALUES ($1,'demo_gt_cashier',$2,'STAFF',$3) RETURNING id`,[gtId,pwHash,hashPin('5678')]);
    await client.query(`INSERT INTO users (store_id,username,password,role,pin) VALUES ($1,'demo_gt_accountant',$2,'ACCOUNTANT',$3)`,[gtId,pwHash,hashPin('3456')]);
    const gtOId=Number(gtOwner.rows[0].id), gtMId=Number(gtManager.rows[0].id), gtCId=Number(gtCashier.rows[0].id);

    const gtCatIds: Record<string,number> = {};
    for (const cat of GT_CATEGORIES) {
      const r = await client.query(`INSERT INTO categories (store_id,name) VALUES ($1,$2) ON CONFLICT (store_id,name) DO UPDATE SET name=EXCLUDED.name RETURNING id`,[gtId,cat]);
      gtCatIds[cat] = Number(r.rows[0].id);
    }

    const gtPIds: number[] = [];
    let gtQC = 11101;
    for (const p of GT_PRODUCTS) {
      const matrix = 'matrix' in p && p.matrix
        ? JSON.stringify(Object.fromEntries(Object.entries((p as any).matrix).map(([k,v]: [string,any])=>[k,{stock:v.stock,price:v.price,cost:(p as any).cost}])))
        : null;
      const r = await client.query(
        `INSERT INTO products (store_id,name,category,category_id,price,cost,stock,condition_matrix,quick_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [gtId,p.name,p.category,gtCatIds[p.category],p.price,(p as any).cost,(p as any).stock??0,matrix,String(gtQC++)],
      );
      gtPIds.push(Number(r.rows[0].id));
    }

    const gtCustIds: number[] = [];
    for (const c of GT_CUSTOMERS) {
      const r = await client.query(`INSERT INTO customers (store_id,name,phone,address) VALUES ($1,$2,$3,$4) RETURNING id`,[gtId,c.name,c.phone,c.address]);
      gtCustIds.push(Number(r.rows[0].id));
    }

    // 30 days of sales
    const gtSaleIds: number[] = [];
    const gtSaleItemIds: number[] = [];
    for (let day=29;day>=0;day--) {
      for (let s=0;s<rnd(2,6);s++) {
        const pi = rnd(0,GT_PRODUCTS.length-1);
        const prod = GT_PRODUCTS[pi];
        const cond = 'matrix' in prod && prod.matrix ? Object.keys(prod.matrix)[0].toUpperCase() : null;
        const price = 'matrix' in prod && prod.matrix ? (prod as any).matrix[cond!.toLowerCase()].price : (prod as any).price;
        const qty = rnd(1,2); const sub = price*qty;
        const pay = s%3===0?{cash:sub,transfer:0,pos:0}:s%3===1?{cash:0,transfer:sub,pos:0}:{cash:0,transfer:0,pos:sub};
        const custId = day%3===0 ? gtCustIds[rnd(0,gtCustIds.length-1)] : null;
        const userId = [gtOId,gtMId,gtCId][rnd(0,2)];
        const sr = await client.query(
          `INSERT INTO sales (store_id,subtotal,total,user_id,payment_methods,status,customer_id,timestamp) VALUES ($1,$2,$2,$3,$4,'COMPLETED',$5,$6) RETURNING id`,
          [gtId,sub,userId,JSON.stringify(pay),custId,daysAgo(day)],
        );
        const saleId = Number(sr.rows[0].id);
        const sir = await client.query(
          `INSERT INTO sale_items (sale_id,product_id,quantity,price_at_sale,base_price_at_sale,subtotal,cost_at_sale,condition) VALUES ($1,$2,$3,$4,$4,$5,$6,$7) RETURNING id`,
          [saleId,gtPIds[pi],qty,price,sub,(prod as any).cost,cond],
        );
        gtSaleIds.push(saleId);
        gtSaleItemIds.push(Number(sir.rows[0].id));
      }
    }

    // Expenses
    for (const [title,category,amount] of [
      ['Monthly Store Rent','Rent',8500],['Electricity & Gas','Utilities',620],['Internet & Phone','Utilities',180],
      ['Google Ads Campaign','Marketing',750],['HVAC Service','Maintenance',320],['Staff Team Lunch','Staff Welfare',210],
      ['Security System Monitoring','Maintenance',95],['Store Cleaning Service','Maintenance',280],
      ['Business Insurance Premium','Insurance',415],['Shipping Supplies','Operations',145],
    ] as [string,string,number][])
      await client.query(`INSERT INTO expenses (store_id,title,category,amount,created_by,spent_at) VALUES ($1,$2,$3,$4,$5,$6)`,[gtId,title,category,amount,gtOId,daysAgo(rnd(1,28))]);

    // Consignment items
    for (const [vendor,phone,item,qty,payout,selling,status,cond,quickCode] of [
      ['Jake\'s Pre-Owned Phones',     '(646) 555-0011','iPhone 14 Pro 128GB',           2, 720, 850, 'approved','Used',     '11101'],
      ['Tech Resale Co.',              '(718) 555-0022','Samsung Galaxy S23 Ultra',       1, 550, 680, 'approved','Open Box', '22202'],
      ['Metro Device Exchange',        '(347) 555-0033','MacBook Pro M2 14" 16GB',        1,1400,1699, 'pending', 'Used',     '33303'],
      ['Rivera Electronics',           '(312) 555-0141','iPhone 13 Pro Max 256GB',        1, 580, 719, 'approved','Used',     '44404'],
      ['Sunset Tech Trades',           '(424) 555-0182','iPad Air 5th Gen 64GB',          2, 390, 499, 'approved','Open Box', '55505'],
      ['Pacific Resellers',            '(206) 555-0193','Google Pixel 7 Pro 128GB',       1, 320, 429, 'approved','Used',     '66606'],
      ['Midwest Device Hub',           '(312) 555-0204','Samsung Galaxy Z Flip5',         1, 560, 699, 'approved','Open Box', '77707'],
      ['Capital Gadget Exchange',      '(202) 555-0215','MacBook Air 13" M1 8GB',         1, 680, 849, 'approved','Used',     '88808'],
      ['Lone Star Tech',               '(512) 555-0226','Apple Watch Series 8 GPS 45mm',  2, 220, 299, 'approved','Open Box', '99909'],
    ] as [string,string,string,number,number,number,string,string,string][])
      await client.query(
        `INSERT INTO consignment_items (store_id,quick_code,vendor_name,vendor_phone,item_name,quantity,agreed_payout,selling_price,status,public_specs,internal_condition,added_by,approved_by,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [gtId,quickCode,vendor,phone,item,qty,payout,selling,status,'{}',cond,gtCId,status!=='pending'?gtMId:null,daysAgo(rnd(3,15))],
      );

    // Vendor payables
    for (const [vendor,ref,item,amount,status,settledDaysAgo,note,sourceType] of [
      ['Jake\'s Pre-Owned Phones',   'VID-GT-001','iPhone 14 Pro 128GB',          720,  'SETTLED', 12, 'Paid via Zelle',      'CONSIGNMENT'],
      ['Tech Resale Co.',            'VID-GT-002','Samsung Galaxy S23 Ultra',     550,  'SETTLED',  9, 'Bank transfer',       'CONSIGNMENT'],
      ['Rivera Electronics',         'VID-GT-003','iPhone 13 Pro Max 256GB',      580,  'UNPAID',   0, null,                  'CONSIGNMENT'],
      ['Sunset Tech Trades',         'VID-GT-004','iPad Air 5th Gen 64GB',        390,  'UNPAID',   0, 'Pending pickup',      'CONSIGNMENT'],
      ['Pacific Resellers',          'VID-GT-005','Google Pixel 7 Pro 128GB',     320,  'UNPAID',   0, null,                  'CONSIGNMENT'],
      ['Midwest Device Hub',         'VID-GT-006','Samsung Galaxy Z Flip5',       560,  'SETTLED',  2, 'Cash on delivery',    'CONSIGNMENT'],
      ['Capital Gadget Exchange',    'VID-GT-007','MacBook Air 13in M1 8GB',      680,  'UNPAID',   0, null,                  'CONSIGNMENT'],
      ['Lone Star Tech',             'VID-GT-008','Apple Watch Series 8 GPS 45mm',220,  'SETTLED',  1, 'Venmo',               'CONSIGNMENT'],
      ['Metro Device Exchange',      'VID-GT-009','MacBook Pro M2 14in 16GB',    1400,  'UNPAID',   0, 'Awaiting invoice',    'CONSIGNMENT'],
      ['Jake\'s Pre-Owned Phones',   'VID-GT-010','iPhone 14 Pro 128GB (2nd)',    720,  'UNPAID',   0, null,                  'CONSIGNMENT'],
    ] as [string,string,string,number,string,number,string|null,string][]) {
      const si = gtSaleIds.length > 0 ? gtSaleIds[rnd(0,Math.min(9,gtSaleIds.length-1))] : 1;
      const sii = gtSaleItemIds.length > 0 ? gtSaleItemIds[rnd(0,Math.min(9,gtSaleItemIds.length-1))] : 1;
      await client.query(
        `INSERT INTO vendor_payables (store_id,sale_id,sale_item_id,vendor_name,vendor_reference,item_name,amount_due,status,settled_at,note,created_at,source_type) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [gtId,si,sii,vendor,ref,item,amount,status,
         status==='SETTLED'?daysAgo(settledDaysAgo):null,
         note,daysAgo(rnd(5,20)),sourceType],
      );
    }

    // Sourced items (sold via POS with sourced_item flag in specs_at_sale)
    for (const [ownerName,ref,itemName,price,cost,daysBack] of [
      ['Kevin Blake',    'KB-2024-01','iPhone 14 128GB',          899,  620, 18],
      ['Marcus Webb',    'MW-2024-02','Samsung Galaxy S22 Ultra',  749,  510, 15],
      ['Derek Nguyen',   'DN-2024-03','MacBook Air M2 13in',      1099,  850, 12],
      ['Kevin Blake',    'KB-2024-04','iPad 10th Gen 64GB',        499,  340, 10],
      ['Angela Foster',  'AF-2024-05','Google Pixel 8 128GB',      649,  470,  8],
      ['Marcus Webb',    'MW-2024-06','Sony WH-1000XM4',           379,  260,  6],
      ['Derek Nguyen',   'DN-2024-07','Dell XPS 13 i5 16GB',      1349, 1050,  4],
      ['Angela Foster',  'AF-2024-08','iPhone 13 256GB',           829,  600,  2],
    ] as [string,string,string,number,number,number][]) {
      const saleR = await client.query(
        `INSERT INTO sales (store_id,subtotal,total,user_id,payment_methods,status,timestamp) VALUES ($1,$2,$3,$4,$5,'COMPLETED',$6) RETURNING id`,
        [gtId,price,price,gtMId,JSON.stringify({cash:price,transfer:0,pos:0}),daysAgo(daysBack)],
      );
      const saleId = Number(saleR.rows[0].id);
      await client.query(
        `INSERT INTO sale_items (sale_id,product_id,quantity,price_at_sale,base_price_at_sale,subtotal,cost_at_sale,specs_at_sale) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [saleId,gtPIds[0],1,price,price,price,cost,
         JSON.stringify({sourced_item:true,sourced_vendor_name:ownerName,sourced_vendor_reference:ref,sourced_item_name:itemName,sourced_cost_price:cost})],
      );
    }

    // Repair tickets
    let ti=1;
    for (const [cn,ph,dev,br,issue,tech,st,est,fin,paid] of [
      ['James Carter','(213) 555-0101','iPhone 13 Pro','Apple','Cracked screen, touch unresponsive','Mike\'s Repair Lab','IN_REPAIR',180,0,50],
      ['Emily Rodriguez','(212) 555-0142','Samsung Galaxy S22','Samsung','Battery drain, random shutdowns','QuickFix NYC','READY',95,95,95],
      ['Michael Thompson','(312) 555-0183','MacBook Air M1','Apple','Keyboard liquid damage','Mike\'s Repair Lab','DIAGNOSING',0,0,0],
      ['Sarah Johnson','(713) 555-0224','iPad Air 4th Gen','Apple','Charging port not working','QuickFix NYC','DELIVERED',65,65,65],
      ['David Kim','(415) 555-0265','Dell XPS 13','Dell','Does not power on','Bay Gadget Repairs','AWAITING_PARTS',145,0,30],
    ] as [string,string,string,string,string,string,string,number,number,number][])
      await client.query(
        `INSERT INTO repair_tickets (store_id,ticket_number,customer_name,customer_phone,device_name,brand,issue_summary,technician_name,status,estimated_cost,final_cost,amount_paid,warranty_status,promised_date,created_by,updated_by,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'NO_WARRANTY',$13,$14,$14,$15)`,
        [gtId,`TH-TKT-${String(ti++).padStart(4,'0')}`,cn,ph,dev,br,issue,tech,st,est,fin,paid,dateAgo(rnd(1,10)),gtMId,daysAgo(rnd(1,10))],
      );

    // Layaway plan — use only $N params (no mixed inline literals) for SQLite compat
    const layR = await client.query(
      `INSERT INTO sales (store_id,subtotal,total,user_id,payment_methods,status,sale_channel,customer_id,payment_plan,locked_until_paid,due_date,note,timestamp) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [gtId,1299,1299,gtMId,JSON.stringify({cash:300,transfer:0,pos:0}),'PENDING','LAYAWAY',gtCustIds[2],JSON.stringify({type:'LAYAWAY',installment_count:3,payment_frequency:'MONTHLY',deposit_paid:300,balance_due:999,schedule:[]}),1,dateAgo(30),'Layaway — $300 down, $999 balance over 3 months',daysAgo(7)],
    );
    await client.query(`INSERT INTO sale_items (sale_id,product_id,quantity,price_at_sale,base_price_at_sale,subtotal,condition) VALUES ($1,$2,$3,$4,$5,$6,$7)`,[Number(layR.rows[0].id),gtPIds[3],1,1299,1299,1299,'NEW']);

    // Suppliers & POs
    const sup1 = await client.query(`INSERT INTO suppliers (store_id,name,phone,email,address) VALUES ($1,'D&H Distributing','(800) 555-0300','orders@dandh.com','2525 N 7th St, Harrisburg, PA') RETURNING id`,[gtId]);
    const sup2 = await client.query(`INSERT INTO suppliers (store_id,name,phone,email,address) VALUES ($1,'Ingram Micro','(800) 555-0400','trade@ingrammicro.com','3351 Michelson Dr, Irvine, CA') RETURNING id`,[gtId]);
    await client.query(
      `INSERT INTO purchase_orders (store_id,supplier_id,supplier_name,order_number,status,items,subtotal,note,expected_date,created_by,created_at) VALUES ($1,$2,$3,$4,'ORDERED',$5,$6,$7,$8,$9,$10)`,
      [gtId,Number(sup1.rows[0].id),'D&H Distributing',`TH-PO-${Date.now()}`,
       JSON.stringify([{name:'iPhone 15 Pro Max 256GB',qty:5,unitCost:950},{name:'AirPods Pro 2nd Gen',qty:8,unitCost:185}]),
       5*950+8*185,'Q4 restocking order',dateAgo(7),gtMId,daysAgo(3)],
    );
    await client.query(
      `INSERT INTO purchase_orders (store_id,supplier_id,supplier_name,order_number,status,items,subtotal,note,expected_date,created_by,received_by,received_at,created_at) VALUES ($1,$2,$3,$4,'RECEIVED',$5,$6,$7,$8,$9,$9,$10,$11)`,
      [gtId,Number(sup2.rows[0].id),'Ingram Micro',`TH-PO-${Date.now()-1000}`,
       JSON.stringify([{name:'USB-C Cable 6ft 3-Pack x 30',qty:30,unitCost:7},{name:'Tempered Glass Screen Guard x 50',qty:50,unitCost:4}]),
       30*7+50*4,'Accessories restock',dateAgo(14),gtMId,daysAgo(10),daysAgo(12)],
    );

    // Stock adjustments
    await client.query(
      `INSERT INTO stock_adjustments (store_id,product_id,adjusted_by,adjustment_type,adjustment_mode,quantity_before,quantity_change,quantity_after,note,created_at) VALUES ($1,$2,$3,'DAMAGED','DECREASE',60,2,58,'Screen protectors cracked during shipping',$4)`,
      [gtId,gtPIds[12],gtMId,daysAgo(5)],
    );
    await client.query(
      `INSERT INTO stock_adjustments (store_id,product_id,adjusted_by,adjustment_type,adjustment_mode,quantity_before,quantity_change,quantity_after,note,created_at) VALUES ($1,$2,$3,'RESTOCK','INCREASE',3,5,8,'New stock received from D&H',$4)`,
      [gtId,gtPIds[8],gtMId,daysAgo(9)],
    );

    // Handover notes
    for (const [text,priority,author] of [
      ['Received 2 iPhones for display consignment from Jake\'s. Logged and tested. Both in excellent condition.','INFO',gtMId],
      ['IMPORTANT: MacBook Pro M2 demo unit (S/N MBA-2024-001) — DO NOT sell. For in-store display only.','IMPORTANT',gtOId],
      ['Customer James Carter called about repair ticket TH-TKT-0001 — quoted 5–7 business days. Follow up Friday.','IMPORTANT',gtCId],
      ['End of day register: $2,840 cash. $2,500 deposited to Chase. $340 kept in safe for change.','INFO',gtCId],
    ] as [string,string,number][])
      await client.query(
        `INSERT INTO handover_notes (store_id,author_id,note_text,priority,is_pinned,created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
        [gtId,author,text,priority,priority==='IMPORTANT'?1:0,daysAgo(rnd(0,3))],
      );

    // Staff attendance (14 days)
    for (let day=13;day>=0;day--) {
      if (day%7===0) continue;
      for (const uid of [gtMId,gtCId]) {
        const ci = new Date(daysAgo(day)); ci.setHours(9,rnd(0,15),0,0);
        const co = new Date(ci); co.setHours(18,rnd(0,30),0,0);
        await client.query(
          `INSERT INTO staff_attendance (store_id,user_id,shift_date,clock_in_at,clock_out_at,total_minutes) VALUES ($1,$2,$3,$4,$5,$6)`,
          [gtId,uid,dateAgo(day),ci.toISOString(),co.toISOString(),Math.round((co.getTime()-ci.getTime())/60000)],
        );
      }
    }

    // Internal messages
    await client.query(`INSERT INTO internal_messages (store_id,sender_id,recipient_id,message_text,is_read,created_at) VALUES ($1,$2,$3,$4,0,$5)`,[gtId,gtMId,gtCId,'Ensure all display units are charged and powered on before opening. Update price tags for Galaxy S24 — new pricing effective today.',daysAgo(1)]);
    await client.query(`INSERT INTO internal_messages (store_id,sender_id,recipient_id,message_text,is_read,created_at) VALUES ($1,$2,$3,$4,1,$5)`,[gtId,gtCId,gtMId,'Done! Everything is set. A customer also asked about trade-in options for their old iPhone — should I refer them to you?',daysAgo(1)]);

    // Market collections
    await client.query(
      `INSERT INTO market_collections (store_id,collector_name,phone,items,expected_return_date,tracking_code,status,note,created_by,created_at) VALUES ($1,$2,$3,$4,$5,$6,'OPEN',$7,$8,$9)`,
      [gtId,'Chris Hernandez','(347) 555-0099',
       JSON.stringify([{name:'Samsung Galaxy A54 (Demo Unit)',qty:1,price:449}]),
       dateAgo(-3),`MC-TH-${Date.now()}`,
       'Sent with vendor for trade show display. Collect by end of week.',gtMId,daysAgo(2)],
    );

    // Sales return
    const saleIds = (await client.query(`SELECT id FROM sales WHERE store_id=$1 AND status='COMPLETED' ORDER BY id LIMIT 5`,[gtId])).rows.map((r:any)=>Number(r.id));
    if (saleIds.length >= 3) {
      await client.query(
        `INSERT INTO sales_returns (sale_id,store_id,processed_by,returned_value,refund_amount,refund_method,return_type,restock_items,reason,items,created_at) VALUES ($1,$2,$3,$4,$4,'cash','REFUND',1,'Customer changed mind — purchased wrong model',$5,$6)`,
        [saleIds[2],gtId,gtMId,249,JSON.stringify([{product_name:'AirPods Pro (2nd Gen)',quantity:1,price_at_sale:249}]),daysAgo(4)],
      );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STORE 2 — FreshMart Grocery (SUPERMARKET)
    // ═══════════════════════════════════════════════════════════════════════
    const smStore = await client.query(
      `INSERT INTO stores (name,mode,receipt_paper_size,license_status,currency_code,tax_enabled,tax_percentage,address,phone)
       VALUES ('FreshMart Grocery','SUPERMARKET','THERMAL','UNLICENSED','USD',0,0,'1155 Oak St, Chicago, IL 60607','(312) 555-4321') RETURNING id`,
    );
    const smId = Number(smStore.rows[0].id);

    const smOwner   = await client.query(`INSERT INTO users (store_id,username,password,role,pin) VALUES ($1,'demo_sm_owner',$2,'STORE_ADMIN',$3) RETURNING id`,[smId,pwHash,hashPin('5000')]);
    const smManager = await client.query(`INSERT INTO users (store_id,username,password,role,pin) VALUES ($1,'demo_sm_manager',$2,'MANAGER',$3) RETURNING id`,[smId,pwHash,hashPin('2000')]);
    const smCashier = await client.query(`INSERT INTO users (store_id,username,password,role,pin) VALUES ($1,'demo_sm_cashier',$2,'STAFF',$3) RETURNING id`,[smId,pwHash,hashPin('3000')]);
    await client.query(`INSERT INTO users (store_id,username,password,role,pin) VALUES ($1,'demo_sm_accountant',$2,'ACCOUNTANT',$3)`,[smId,pwHash,hashPin('4000')]);
    const smOId=Number(smOwner.rows[0].id), smMId=Number(smManager.rows[0].id), smCId=Number(smCashier.rows[0].id);

    const smCatIds: Record<string,number> = {};
    for (const cat of SM_CATEGORIES) {
      const r = await client.query(`INSERT INTO categories (store_id,name) VALUES ($1,$2) ON CONFLICT (store_id,name) DO UPDATE SET name=EXCLUDED.name RETURNING id`,[smId,cat]);
      smCatIds[cat] = Number(r.rows[0].id);
    }

    const smPIds: number[] = [];
    let smQC = 22101;
    for (const p of SM_PRODUCTS) {
      const r = await client.query(`INSERT INTO products (store_id,name,category,category_id,price,cost,stock,quick_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[smId,p.name,p.category,smCatIds[p.category],p.price,p.cost,p.stock,String(smQC++)]);
      smPIds.push(Number(r.rows[0].id));
    }

    const smCustIds: number[] = [];
    for (const c of SM_CUSTOMERS) {
      const r = await client.query(`INSERT INTO customers (store_id,name,phone,address) VALUES ($1,$2,$3,$4) RETURNING id`,[smId,c.name,c.phone,c.address]);
      smCustIds.push(Number(r.rows[0].id));
    }

    // 30 days of supermarket sales (high volume, multi-item baskets)
    for (let day=29;day>=0;day--) {
      for (let s=0;s<rnd(6,14);s++) {
        let sub=0; const basket: Array<{id:number;price:number;qty:number;cost:number}>=[];
        for (let b=0;b<rnd(2,6);b++) {
          const pi=rnd(0,SM_PRODUCTS.length-1); const qty=rnd(1,4);
          sub+=SM_PRODUCTS[pi].price*qty;
          basket.push({id:smPIds[pi],price:SM_PRODUCTS[pi].price,qty,cost:SM_PRODUCTS[pi].cost});
        }
        sub=Math.round(sub*100)/100;
        const pay=s%4===0?{cash:sub,transfer:0,pos:0}:s%4===1?{cash:0,transfer:sub,pos:0}:s%4===2?{cash:0,transfer:0,pos:sub}:{cash:Math.round(sub/2*100)/100,transfer:Math.round(sub/2*100)/100,pos:0};
        const custId=day%4===0?smCustIds[rnd(0,smCustIds.length-1)]:null;
        const userId=[smOId,smMId,smCId][rnd(0,2)];
        const sr = await client.query(`INSERT INTO sales (store_id,subtotal,total,user_id,payment_methods,status,customer_id,timestamp) VALUES ($1,$2,$2,$3,$4,'COMPLETED',$5,$6) RETURNING id`,[smId,sub,userId,JSON.stringify(pay),custId,daysAgo(day)]);
        const sid=Number(sr.rows[0].id);
        for (const bi of basket)
          await client.query(`INSERT INTO sale_items (sale_id,product_id,quantity,price_at_sale,base_price_at_sale,subtotal,cost_at_sale) VALUES ($1,$2,$3,$4,$4,$5,$6)`,[sid,bi.id,bi.qty,bi.price,Math.round(bi.price*bi.qty*100)/100,bi.cost]);
      }
    }

    // Expenses
    for (const [title,category,amount] of [
      ['Monthly Store Lease','Rent',6200],['Electricity','Utilities',980],['Natural Gas','Utilities',310],
      ['Produce Spoilage Write-off','Operations',420],['Staff Uniforms','Staff Welfare',380],
      ['POS Terminal Lease','Equipment',150],['Refrigeration Service','Maintenance',560],
      ['Storefront Cleaning','Maintenance',200],['Health Permit Renewal','Operations',275],
    ] as [string,string,number][])
      await client.query(`INSERT INTO expenses (store_id,title,category,amount,created_by,spent_at) VALUES ($1,$2,$3,$4,$5,$6)`,[smId,title,category,amount,smOId,daysAgo(rnd(1,28))]);

    // Suppliers & POs
    const ssup1 = await client.query(`INSERT INTO suppliers (store_id,name,phone,email,address) VALUES ($1,'Sysco Corporation','(800) 555-0800','orders@sysco.com','1390 Enclave Pkwy, Houston, TX') RETURNING id`,[smId]);
    const ssup2 = await client.query(`INSERT INTO suppliers (store_id,name,phone,email,address) VALUES ($1,'US Foods','(800) 555-0900','trade@usfoods.com','9399 W Higgins Rd, Rosemont, IL') RETURNING id`,[smId]);
    await client.query(
      `INSERT INTO purchase_orders (store_id,supplier_id,supplier_name,order_number,status,items,subtotal,note,expected_date,created_by,created_at) VALUES ($1,$2,$3,$4,'ORDERED',$5,$6,$7,$8,$9,$10)`,
      [smId,Number(ssup1.rows[0].id),'Sysco Corporation',`FM-PO-${Date.now()}`,
       JSON.stringify([{name:'Jasmine Rice 5lb x 50 bags',qty:50,unitCost:4.50},{name:'Whole Milk Gallon x 48',qty:48,unitCost:2.70}]),
       50*4.50+48*2.70,'Weekly grocery restocking',dateAgo(3),smMId,daysAgo(2)],
    );
    await client.query(
      `INSERT INTO purchase_orders (store_id,supplier_id,supplier_name,order_number,status,items,subtotal,note,expected_date,created_by,received_by,received_at,created_at) VALUES ($1,$2,$3,$4,'RECEIVED',$5,$6,$7,$8,$9,$9,$10,$11)`,
      [smId,Number(ssup2.rows[0].id),'US Foods',`FM-PO-${Date.now()-2000}`,
       JSON.stringify([{name:'Tide Pods 42-Count x 12',qty:12,unitCost:9.50},{name:'Bounty Paper Towels 6-Pack x 20',qty:20,unitCost:6.80}]),
       12*9.50+20*6.80,'Household products restock',dateAgo(10),smMId,daysAgo(8),daysAgo(9)],
    );

    // Stock adjustments
    await client.query(
      `INSERT INTO stock_adjustments (store_id,product_id,adjusted_by,adjustment_type,adjustment_mode,quantity_before,quantity_change,quantity_after,note,created_at) VALUES ($1,$2,$3,'DAMAGED','DECREASE',120,6,114,'Broken Coca-Cola bottles — dropped in receiving area',$4)`,
      [smId,smPIds[0],smMId,daysAgo(4)],
    );
    await client.query(
      `INSERT INTO stock_adjustments (store_id,product_id,adjusted_by,adjustment_type,adjustment_mode,quantity_before,quantity_change,quantity_after,note,created_at) VALUES ($1,$2,$3,'COUNT','SET',75,0,70,'Cycle count — 5-unit variance found in Rice aisle',$4)`,
      [smId,smPIds[6],smMId,daysAgo(7)],
    );
    await client.query(
      `INSERT INTO stock_adjustments (store_id,product_id,adjusted_by,adjustment_type,adjustment_mode,quantity_before,quantity_change,quantity_after,note,created_at) VALUES ($1,$2,$3,'RESTOCK','INCREASE',15,40,55,'New shipment received from Sysco',$4)`,
      [smId,smPIds[14],smMId,daysAgo(9)],
    );

    // Handover notes
    for (const [text,priority,author] of [
      ['Dairy cooler temperature alarm triggered at 6pm — maintenance called. Do NOT restock until temp is confirmed stable.','IMPORTANT',smMId],
      ['Restocked Beverages and Snacks aisles. Coca-Cola and Lay\'s both running low — PO already submitted to Sysco.','INFO',smCId],
      ['EOD cash: $1,842.50. Deposited $1,800 to Chase. $42.50 in petty cash.','INFO',smCId],
      ['New vendor rep from Sysco visited — offered 8% discount on orders over $2,000. Owner has their contact card.','INFO',smMId],
    ] as [string,string,number][])
      await client.query(
        `INSERT INTO handover_notes (store_id,author_id,note_text,priority,is_pinned,created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
        [smId,author,text,priority,priority==='IMPORTANT'?1:0,daysAgo(rnd(0,3))],
      );

    // Staff attendance
    for (let day=13;day>=0;day--) {
      if (day%7===0) continue;
      for (const uid of [smMId,smCId]) {
        const ci=new Date(daysAgo(day)); ci.setHours(7,rnd(30,59),0,0);
        const co=new Date(ci); co.setHours(16,rnd(0,30),0,0);
        await client.query(
          `INSERT INTO staff_attendance (store_id,user_id,shift_date,clock_in_at,clock_out_at,total_minutes) VALUES ($1,$2,$3,$4,$5,$6)`,
          [smId,uid,dateAgo(day),ci.toISOString(),co.toISOString(),Math.round((co.getTime()-ci.getTime())/60000)],
        );
      }
    }

    // Internal messages
    await client.query(`INSERT INTO internal_messages (store_id,sender_id,recipient_id,message_text,is_read,created_at) VALUES ($1,$2,$3,$4,0,$5)`,[smId,smMId,smCId,'Please do a full count on the Frozen Foods section first thing tomorrow. We need accurate numbers before the Sysco order.',daysAgo(1)]);
    await client.query(`INSERT INTO internal_messages (store_id,sender_id,recipient_id,message_text,is_read,created_at) VALUES ($1,$2,$3,$4,1,$5)`,[smId,smCId,smOId,'Counted — Frozen is fine except DiGiorno Pizza: only 4 left. Should I add to the PO?',daysAgo(1)]);

    // Market collections
    await client.query(
      `INSERT INTO market_collections (store_id,collector_name,phone,items,expected_return_date,tracking_code,status,note,created_by,created_at) VALUES ($1,$2,$3,$4,$5,$6,'OPEN',$7,$8,$9)`,
      [smId,'Tom Bradley','(773) 555-0077',
       JSON.stringify([{name:'Assorted Beverages (24 cans)',qty:24,price:1.99}]),
       dateAgo(-5),`MC-FM-${Date.now()}`,
       'Sent to community fundraiser event. Unsold stock returns Monday.',smMId,daysAgo(1)],
    );

    // Sales return
    const smSaleIds = (await client.query(`SELECT id FROM sales WHERE store_id=$1 AND status='COMPLETED' ORDER BY id LIMIT 5`,[smId])).rows.map((r:any)=>Number(r.id));
    if (smSaleIds.length >= 3) {
      await client.query(
        `INSERT INTO sales_returns (sale_id,store_id,processed_by,returned_value,refund_amount,refund_method,return_type,restock_items,reason,items,created_at) VALUES ($1,$2,$3,$4,$4,'cash','REFUND',1,'Wrong product — customer returned unopened',$5,$6)`,
        [smSaleIds[2],smId,smMId,2.79,JSON.stringify([{product_name:'Coca-Cola 2L',quantity:1,price_at_sale:2.79}]),daysAgo(3)],
      );
    }

    // FreshMart consignment vendor items
    let smCIQC = 33101;
    for (const [vendor,phone,item,qty,payout,selling,status,cond] of [
      ['Green Valley Farms',    '(312) 555-0181','Organic Honey 12oz (6-Pack)',    6,  28, 42, 'approved','New'],
      ['Sunrise Bakery Co.',    '(773) 555-0192','Artisan Sourdough Loaves',       4,  18, 28, 'approved','New'],
      ['Local Harvest LLC',     '(847) 555-0203','Fresh Herb Bundle — Basil & Mint',8, 12, 18, 'approved','New'],
      ['Prairie Dairy Works',   '(630) 555-0214','Small-Batch Butter 8oz (4-Pack)', 4, 22, 34, 'approved','New'],
      ['Great Lakes Roasters',  '(312) 555-0225','Craft Coffee Blend 12oz',        5, 16, 26, 'pending', 'New'],
      ['Midwest Pickle Co.',    '(708) 555-0236','Dill Pickle Jars (3-Pack)',       6, 14, 22, 'approved','New'],
    ] as [string,string,string,number,number,number,string,string][])
      await client.query(
        `INSERT INTO consignment_items (store_id,quick_code,vendor_name,vendor_phone,item_name,quantity,agreed_payout,selling_price,status,public_specs,internal_condition,added_by,approved_by,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [smId,String(smCIQC++),vendor,phone,item,qty,payout,selling,status,'{}',cond,smOId,status!=='pending'?smMId:null,daysAgo(rnd(2,10))],
      );

    await client.query('COMMIT');
    return { message: 'Demo data seeded! TechHub Electronics (Smart Retail) + FreshMart Grocery (Supermarket) are ready with 30 days of activity.' };
  } catch (err: any) {
    await client.query('ROLLBACK');
    throw new Error(`Demo seed failed: ${err.message}`);
  } finally {
    client.release();
  }
}
