const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATA_SOURCE_ID = process.env.NOTION_DATA_SOURCE_ID;

if (!NOTION_TOKEN) throw new Error("NOTION_TOKEN がありません");
if (!DATA_SOURCE_ID) throw new Error("NOTION_DATA_SOURCE_ID がありません");

const NOTION_VERSION = "2026-03-11";
const NOTION_API_BASE = "https://api.notion.com/v1";

const dryRun = false;

const WORK_DATE_PROPERTY = "work日時";
const TAG_PROPERTY = "タグ";
const DELETE_TAG_NAME = "なし";

type Page = {
  object: "page";
  id: string;
  properties: Record<string, any>;
};

type QueryResponse = {
  object: "list";
  results: unknown[];
  next_cursor: string | null;
  has_more: boolean;
};

async function notionPost(path: string, body: unknown) {
  const bodyString = JSON.stringify(body);
  const res = await fetch(`${NOTION_API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: bodyString,
  });


  const data = await res.json();

  if (!res.ok) {
    console.error("Notion API Error:");
    console.error(data);
    throw new Error(`Notion API error: ${res.status}`);
  }

  return data;
}

async function notionPatch(path: string, body: unknown) {
  const res = await fetch(`${NOTION_API_BASE}${path}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (!res.ok) {
    console.error("Notion API Error:");
    console.error(data);
    throw new Error(`Notion API error: ${res.status}`);
  }

  return data;
}

function tokyoDate(date: Date) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function today() {
  return tokyoDate(new Date());
}

function daysAgo(n: number) {
  return tokyoDate(new Date(Date.now() - n * 24 * 60 * 60 * 1000));
}

function addDays(dateString: string, days: number) {
  const date = new Date(`${dateString}T00:00:00+09:00`);
  date.setDate(date.getDate() + days);
  return tokyoDate(date);
}

function isPage(item: unknown): item is Page {
  return (
    typeof item === "object" &&
    item !== null &&
    (item as Page).object === "page" &&
    typeof (item as Page).id === "string"
  );
}

/**
 * work日時 は date プロパティではなく formula.date。
 */
function getWorkDate(page: Page) {
  const prop = page.properties[WORK_DATE_PROPERTY];

  const start = prop?.formula?.date?.start;

  if (!start) return null;

  return tokyoDate(new Date(start));
}

/**
 * タグ multi_select に「なし」が含まれているか。
 * なし有無列は使わない。
 */
function hasNoneTag(page: Page) {
  const prop = page.properties[TAG_PROPERTY];

  return (
    prop?.multi_select?.some((tag: any) => tag.name === DELETE_TAG_NAME) ??
    false
  );
}

async function queryTargetPages(fromDate: string, toDate: string) {
  const data = (await notionPost(`/data_sources/${DATA_SOURCE_ID}/query`, {
    page_size: 100,
    // in_trash: false,
    is_archived: false,
    result_type: "page",

    filter: {
      and: [
        {
          property: WORK_DATE_PROPERTY,
          formula: {
            date: {
              on_or_after: `${fromDate}T00:00:00+09:00`,
            },
          },
        },
        {
          property: WORK_DATE_PROPERTY,
          formula: {
            date: {
              before: `${toDate}T00:00:00+09:00`,
            },
          },
        },
      ],
    },

    sorts: [
      {
        property: WORK_DATE_PROPERTY,
        direction: "ascending",
      },
    ],
  })) as QueryResponse;

  if (data.has_more) {
    console.log("注意: 取得結果が100件を超えています。今回は最初の100件だけ処理します。");
  }
  return data.results.filter(isPage);
}

async function trashPage(pageId: string) {
  return notionPatch(`/pages/${pageId}`, {
    in_trash: true,
  });
}

async function main() {
  const fromDate = daysAgo(3);
  const toDate = addDays(today(), 1);

  console.log("====================================");
  console.log("Notion 重複データ削除チェック fetch版");
  console.log("====================================");
  console.log(`対象期間: ${fromDate} 〜 ${toDate} 未満`);
  console.log(`dryRun: ${dryRun}`);
  console.log("");

  const pages = await queryTargetPages(fromDate, toDate);

  console.log(`取得件数: ${pages.length}`);

  if (pages.length === 0) {
    console.log("対象期間のページがありません");
    return;
  }

  const pagesByDate = new Map<string, Page[]>();

  for (const page of pages) {
    const date = getWorkDate(page);

    if (!date) {
      console.log(`work日時を取得できないためスキップ: ${page.id}`);
      continue;
    }

    const sameDatePages = pagesByDate.get(date) ?? [];
    sameDatePages.push(page);
    pagesByDate.set(date, sameDatePages);
  }

  const targets: Page[] = [];

  for (const [date, sameDatePages] of pagesByDate.entries()) {
    if (sameDatePages.length < 2) {
      continue;
    }

    console.log("");
    console.log(`重複日付: ${date}`);
    console.log(`同日件数: ${sameDatePages.length}`);

    for (const page of sameDatePages) {
      if (hasNoneTag(page)) {
        targets.push(page);
        console.log(`- 削除候補: ${page.id}`);
      } else {
        console.log(`- 残す: ${page.id}`);
      }
    }
  }

  console.log("");
  console.log(`削除候補: ${targets.length}`);

  if (targets.length === 0) {
    console.log("削除対象はありません");
    return;
  }

  for (const page of targets) {
    if (dryRun) {
      continue;
    }

    await trashPage(page.id);
    console.log(`ゴミ箱へ移動: ${page.id}`);
  }

  if (dryRun) {
    console.log("dryRun=true なので削除していません");
    console.log("問題なければ dryRun=false に変更してください");
  }
}

main().catch((error) => {
  console.error("エラーが発生しました:");
  console.error(error);
  process.exit(1);
});