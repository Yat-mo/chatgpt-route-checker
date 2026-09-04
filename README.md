# ChatGPT Route Checker

腳本會自動讀取 ChatGPT 當前這輪對話請求中的模型相關欄位，並把關鍵結果顯示在頁面右下角。

主要比對客戶端請求的 `request.model` 與服務端回傳的 `server_ste_metadata.model_slug`，同時顯示 `assistant metadata.model_slug`、`resolved_model_slug`、`requested_model_experience` 與 DOM 中的 `data-message-model-slug`，方便交叉驗證。

友鏈：[LINUX DO](https://linux.do)

## 功能

- 每輪自動擷取 `request.model` 與 `thinking_effort`
- 交叉檢查服務端 metadata、assistant metadata、resolved model 與頁面 DOM
- 支援嚴格比對，model slug 不完全一致時立即提示
- 顯示正常、檢測中、需留意與路由不一致等狀態
- 面板可最小化、展開、拖曳及重設位置
- 可複製完整技術資料，方便排查缺失欄位
- 支援 ChatGPT 深色與淺色介面
- 記住最小化與嚴格模式設定
- 取得主要服務端標注前只顯示檢測中或正在確認，不會先判定一致

## 安裝

1. 安裝 [Tampermonkey](https://www.tampermonkey.net/)。
2. 開啟 [安裝 ChatGPT Route Checker](https://raw.githubusercontent.com/Yat-mo/chatgpt-route-checker/main/chatgpt-route-checker.user.js)。
3. 在 Tampermonkey 顯示的頁面確認安裝。
4. 重新整理 ChatGPT，再送出一條新訊息。

腳本支援：

- `https://chatgpt.com/*`
- `https://chat.openai.com/*`

## 狀態判讀

| 狀態 | 意義 |
| --- | --- |
| 綠色 | 請求模型與主要服務端標注一致，且沒有衝突證據 |
| 黃色 | 次要 metadata、DOM 或同系列 slug 有差異，建議展開查看 |
| 紅色 | 嚴格模式發現 slug 不一致，或可見資料顯示較低的模型／推理層級 |
| 灰色 | 等待訊息或尚未取得足夠資料 |

`null` 或「未提供」代表該輪前端資料沒有出現相應欄位。它不代表欄位擷取故障，也不應自動視為降級。

## 為什麼部分欄位沒有顯示

ChatGPT 不會在每輪回覆中固定送出所有模型欄位。`assistant metadata.model_slug`、`resolved_model_slug` 與回覆端的 `thinking_effort` 有時不會出現在當輪串流或遙測資料裡。

舊版會掃描頁面收到的所有遙測封包，而且沒有完整隔離每一輪資料，因此較容易顯示齊全，也有機會混入其他遙測事件或上一輪留下的值。v6 會在新一輪開始時清空舊資料，並記錄每輪的擷取狀態，以減少舊值混入。正文結束後，腳本會再等待 15 秒接收延遲送達的遙測；這段時間顯示「正在確認」。

## 使用方式

- 點擊右下角狀態膠囊可展開完整面板。
- 開啟「嚴格比對」後，只要 model slug 不完全一致便會提示。
- 點擊複製按鈕可取得本輪 JSON 技術資料。
- 點擊刷新按鈕會重新掃描目前頁面上可見的模型資料。
- 面板只保留最近一輪訊息的結果。

## 判斷限制

這個腳本讀取 ChatGPT 前端可以觀察到的請求、串流 metadata、遙測標注與 DOM 屬性。這些資料適合用來檢查路由標注是否一致，但不能單獨證明實際執行的物理後端模型，也不能直接衡量回答品質或推理能力。

ChatGPT 的接口與欄位可能隨時調整。若部分欄位沒有顯示，請先複製技術資料，並在 Issue 中附上已移除私人內容的結果。

## 私隱

腳本在瀏覽器本地執行，不會主動把對話內容或檢測資料傳送到第三方服務。它只讀取 ChatGPT 頁面本身可見的請求與回應資訊。

## License

[MIT](LICENSE)
