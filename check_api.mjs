import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function check() {
  const res = await fetch('https://partnerx.cc/api/dashboard/overview?companyId=00000000-0000-0000-0000-000000000001&role=boss&userId=276a26db-19a0-4355-8db5-16d1f05928d1', {
    headers: {
      'cookie': 'partnerx_role=boss; partnerx_user_id=276a26db-19a0-4355-8db5-16d1f05928d1; partnerx_company_id=00000000-0000-0000-0000-000000000001'
    }
  });
  const text = await res.text();
  console.log('Status:', res.status);
  console.log('Response text:', text.slice(0, 1000));
}
check();
