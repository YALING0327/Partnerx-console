import https from 'https';

const data = JSON.stringify({
  companyId: "00000000-0000-0000-0000-000000000001",
  role: "boss",
  userId: "044bfd5a-05a5-4e9d-93a6-9835b914be2c"
});

const options = {
  hostname: 'partnerx.cc',
  port: 443,
  path: '/api/dashboard/overview',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length,
    'Cookie': 'partnerx_role=boss; partnerx_user_id=044bfd5a-05a5-4e9d-93a6-9835b914be2c; partnerx_company_id=00000000-0000-0000-0000-000000000001'
  }
};

const req = https.request(options, res => {
  console.log(`statusCode: ${res.statusCode}`);
  let body = '';
  res.on('data', d => { body += d; });
  res.on('end', () => {
    console.log(body.slice(0, 500));
    try {
      const j = JSON.parse(body);
      console.log('Summary:', j.summary);
      console.log('Sample emp:', j.employees[0].name, j.employees[0].totalAmount);
    } catch(e) {}
  });
});

req.on('error', error => { console.error(error); });
req.write(data);
req.end();
