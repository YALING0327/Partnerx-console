import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { querySelectDB } from '@/lib/selectdb';
import { authenticate, getVisibleEmployees, type ChatAuthBody } from '@/lib/chat-auth';

type Body = ChatAuthBody & { platformUserIds?: string[] };

type SelectDbRow = {
  platform_user_id: string | number;
  nickname?: string | null;
  event_created_time?: string | null;
};

function normalizeText(value: unknown) {
  return String(value ?? '').trim();
}

function placeholders(size: number) {
  return new Array(size).fill('?').join(',');
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const auth = await authenticate(body);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const requestedIds = [...new Set((body.platformUserIds ?? []).map(normalizeText).filter(Boolean))].slice(0, 20);
    if (requestedIds.length === 0) {
      return NextResponse.json({ nicknames: {} });
    }

    let visibleQuery = supabaseServer
      .from('attribution_users')
      .select('platform_user_id, employee_id')
      .eq('company_id', auth.companyId)
      .in('platform_user_id', requestedIds);

    if (auth.role === 'staff') {
      const visibleEmployees = await getVisibleEmployees(auth.companyId, auth.role, body.userId!);
      const visibleEmployeeIds = visibleEmployees.map((item) => item.id);
      if (visibleEmployeeIds.length === 0) {
        return NextResponse.json({ nicknames: {} });
      }
      visibleQuery = visibleQuery.in('employee_id', visibleEmployeeIds);
    }

    const { data: visibleRows, error: visibleError } = await visibleQuery;
    if (visibleError) {
      throw visibleError;
    }

    const visibleUserIds = [...new Set((visibleRows ?? []).map((item) => normalizeText(item.platform_user_id)).filter(Boolean))];
    if (visibleUserIds.length === 0) {
      return NextResponse.json({ nicknames: {} });
    }

    const rows = await querySelectDB<SelectDbRow>(
      `
        SELECT
          CAST(account_id AS STRING) AS platform_user_id,
          json_extract_string(CONCAT('', CAST(properties AS STRING)), '$.nickname') AS nickname,
          CAST(event_created_time AS STRING) AS event_created_time
        FROM \`user\`
        WHERE CAST(account_id AS STRING) IN (${placeholders(visibleUserIds.length)})
        ORDER BY event_created_time DESC
        LIMIT ${Math.max(visibleUserIds.length * 5, 20)}
      `,
      visibleUserIds
    );

    const nicknames: Record<string, string> = {};
    for (const row of rows) {
      const platformUserId = normalizeText(row.platform_user_id);
      const nickname = normalizeText(row.nickname);
      if (!platformUserId || !nickname || nicknames[platformUserId]) continue;
      nicknames[platformUserId] = nickname;
    }

    return NextResponse.json({ nicknames });
  } catch (error) {
    console.error('dashboard/user-nicknames 异常', error);
    return NextResponse.json({ error: '读取用户昵称失败' }, { status: 500 });
  }
}
