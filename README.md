# notion-choco

Notion のデータソースから直近の対象期間にあるページを取得し、同じ `work日時` に複数ページがある場合に、タグ `なし` が付いたページを削除候補として判定する Bun スクリプトです。

現在は `dryRun = true` のため、削除候補の判定とログ出力のみを行い、実際には Notion のゴミ箱へ移動しません。

## 実行方法

依存関係をインストールします。

```bash
bun install
```

環境変数を設定します。

```bash
export NOTION_TOKEN="secret_xxx"
export NOTION_DATA_SOURCE_ID="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

スクリプトを実行します。

```bash
bun run index.ts
```

## 必須環境変数

| 変数名 | 用途 |
| --- | --- |
| `NOTION_TOKEN` | Notion API の Bearer token |
| `NOTION_DATA_SOURCE_ID` | 検索対象の Notion data source ID |

起動時にどちらかが未設定の場合は、処理を開始せずにエラーを投げます。

## 対象条件

| 項目 | 値 |
| --- | --- |
| Notion API version | `2025-09-03` |
| 対象プロパティ | `work日時` |
| 削除判定に使うタグプロパティ | `タグ` |
| 削除候補タグ名 | `なし` |
| 対象期間 | 東京時間で「3日前」から「明日 00:00」未満 |
| 最大取得件数 | 100件 |

`work日時` は Notion の `date` プロパティではなく、`formula.date` として扱います。

## 関数一覧

| 関数 | 概要 | 主な連携先 |
| --- | --- | --- |
| `notionPost(path, body)` | Notion API に `POST` リクエストを送る共通関数。レスポンス JSON を返し、API エラー時は内容をログ出力して例外を投げます。 | `queryTargetPages` |
| `notionPatch(path, body)` | Notion API に `PATCH` リクエストを送る共通関数。レスポンス JSON を返し、API エラー時は内容をログ出力して例外を投げます。 | `trashPage` |
| `tokyoDate(date)` | `Date` を東京時間の `YYYY-MM-DD` 文字列に変換します。 | `today`, `daysAgo`, `addDays`, `getWorkDate` |
| `today()` | 現在日時を東京時間の日付文字列で返します。 | `main` |
| `daysAgo(n)` | 現在日時から `n` 日前の日付を東京時間の日付文字列で返します。 | `main` |
| `addDays(dateString, days)` | `YYYY-MM-DD` 形式の日付に指定日数を加算し、東京時間の日付文字列で返します。 | `main` |
| `isPage(item)` | Notion API の結果がページオブジェクトかどうかを判定する型ガードです。 | `queryTargetPages` |
| `getWorkDate(page)` | ページの `work日時` プロパティから `formula.date.start` を取り出し、東京時間の日付文字列に変換します。取得できない場合は `null` を返します。 | `main` |
| `hasNoneTag(page)` | ページの `タグ` multi select に `なし` が含まれているかを判定します。 | `main` |
| `queryTargetPages(fromDate, toDate)` | 指定期間内のページを Notion data source から取得します。`work日時` で期間フィルタと昇順ソートを行い、ページだけに絞り込みます。 | `notionPost`, `isPage`, `main` |
| `trashPage(pageId)` | 指定ページの `in_trash` を `true` にして Notion のゴミ箱へ移動します。 | `notionPatch`, `main` |
| `main()` | 対象期間の計算、ページ取得、日付別グルーピング、重複日の検出、タグ `なし` の削除候補判定、必要に応じたゴミ箱移動を実行します。 | ほぼ全関数 |

## 処理フロー

1. 起動時に `NOTION_TOKEN` と `NOTION_DATA_SOURCE_ID` を検証します。
2. `main()` が東京時間を基準に対象期間を計算します。
   - 開始日: `daysAgo(3)`
   - 終了日: `addDays(today(), 1)`
3. `queryTargetPages()` が Notion data source を検索します。
   - `work日時 >= 開始日 00:00 +09:00`
   - `work日時 < 終了日 00:00 +09:00`
   - `work日時` 昇順
   - `in_trash: false`
4. 取得結果を `isPage()` でページだけに絞り込みます。
5. 各ページの `work日時` を `getWorkDate()` で日付化し、同じ日付ごとにグルーピングします。
6. 同じ日付に2件以上ある場合、その日付を重複日付として扱います。
7. 重複日付内の各ページに対して `hasNoneTag()` を実行します。
   - `タグ` に `なし` があるページ: 削除候補
   - `タグ` に `なし` がないページ: 残す
8. 削除候補がある場合、`dryRun` を確認します。
   - `dryRun = true`: 削除せず、候補数と注意文をログ出力
   - `dryRun = false`: `trashPage()` で Notion のゴミ箱へ移動
9. `main().catch(...)` で未処理エラーを捕捉し、エラー内容を出力して `process.exit(1)` で終了します。

## 関数連携図

```text
main
├─ daysAgo
│  └─ tokyoDate
├─ today
│  └─ tokyoDate
├─ addDays
│  └─ tokyoDate
├─ queryTargetPages
│  ├─ notionPost
│  └─ isPage
├─ getWorkDate
│  └─ tokyoDate
├─ hasNoneTag
└─ trashPage
   └─ notionPatch

main().catch
└─ エラーログ出力と process.exit(1)
```

## 削除を有効化する場合

`index.ts` の以下を変更します。

```ts
const dryRun = true;
```

実削除する場合は次のようにします。

```ts
const dryRun = false;
```

`dryRun = false` にすると、削除候補ページは Notion API により `in_trash: true` に更新されます。
