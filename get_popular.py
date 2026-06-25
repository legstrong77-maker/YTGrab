import sys
import os
import json
import time
import random
import yt_dlp

def detect_available_browser():
    """偵測系統中可用的瀏覽器 cookies，避免 YouTube 的 Bot 阻擋。"""
    for browser in ['chrome', 'edge', 'firefox']:
        try:
            ydl_opts = {
                'quiet': True,
                'no_warnings': True,
                'cookiesfrombrowser': (browser,),
            }
            # 測試是否能正常初始化並讀取 cookies 存取 YouTube
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.extract_info('https://www.youtube.com/watch?v=dQw4w9WgXcQ', download=False)
            print(f"成功偵測並載入瀏覽器 cookies: {browser}", flush=True)
            return browser
        except Exception:
            continue
    print("未偵測到可用且已登入的瀏覽器 cookies，將以無 cookies 模式執行。", flush=True)
    return None

def main():
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except AttributeError:
        pass

    channel_url = "https://www.youtube.com/@haovoice/videos"
    
    # 偵測瀏覽器
    browser = detect_available_browser()
    
    ydl_opts = {
        'skip_download': True,
        'quiet': True,
        'no_warnings': True,
    }
    if browser:
        ydl_opts['cookiesfrombrowser'] = (browser,)
        
    print("正在獲取頻道影片列表...", flush=True)
    
    # 1. 先用 flat-playlist 獲取所有影片的 URL
    ydl_opts_flat = ydl_opts.copy()
    ydl_opts_flat['extract_flat'] = True
    
    with yt_dlp.YoutubeDL(ydl_opts_flat) as ydl:
        try:
            channel_info = ydl.extract_info(channel_url, download=False)
        except Exception as e:
            print(f"無法獲取頻道資訊: {e}")
            sys.exit(1)
            
    entries = channel_info.get('entries', [])
    if not entries:
        print("未找到任何影片。")
        sys.exit(1)
        
    print(f"共找到 {len(entries)} 部影片，開始獲取觀看次數（使用單一連線複用以防阻擋）...", flush=True)
    
    results = []
    
    # 使用同一個 YoutubeDL 物件順序獲取，複用連線與 Session
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        for i, entry in enumerate(entries, 1):
            url = entry.get('url')
            if not url:
                continue
                
            try:
                # 獲取影片詳細資料
                info = ydl.extract_info(url, download=False)
                if info:
                    video_data = {
                        'title': info.get('title'),
                        'url': info.get('webpage_url'),
                        'view_count': info.get('view_count') or 0,
                        'duration': info.get('duration'),
                        'upload_date': info.get('upload_date'),
                    }
                    results.append(video_data)
                    print(f"[{i}/{len(entries)}] 成功獲取: {video_data['title']} ({video_data['view_count']:,} 次觀看)", flush=True)
            except Exception as e:
                # 即使部分影片獲取失敗（例如會員影片），也繼續獲取其他影片
                print(f"[{i}/{len(entries)}] 獲取失敗 {url}: {str(e)[:100]}...", flush=True)
            
            # 加入微小隨機延遲，模擬真人行為
            time.sleep(random.uniform(0.3, 0.8))
                
    # 2. 依照觀看數排序
    results.sort(key=lambda x: x['view_count'], reverse=True)
    
    # 3. 輸出前 100 名
    top_100 = results[:100]
    
    print("\n--- 觀看數前 100 名影片 ---")
    for idx, item in enumerate(top_100, 1):
        print(f"{idx:3d}. 觀看數: {item['view_count']:,} | 標題: {item['title']} | 連結: {item['url']}")
        
    # 同時將結果存成 JSON 和 Markdown 檔案
    output_data = {
        'channel': channel_info.get('title', '郝聲音'),
        'total_videos_found': len(entries),
        'top_videos': top_100
    }
    
    with open('top_100_videos.json', 'w', encoding='utf-8') as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)
        
    with open('top_100_videos.md', 'w', encoding='utf-8') as f:
        f.write(f"# 郝聲音 (@haovoice) 觀看數前 100 名影片\n\n")
        f.write(f"共分析了 {len(entries)} 部影片。以下為觀看次數排序前 100 名的影片：\n\n")
        f.write("| 排名 | 觀看次數 | 影片標題 | 影片連結 |\n")
        f.write("| --- | --- | --- | --- |\n")
        for idx, item in enumerate(top_100, 1):
            f.write(f"| {idx} | {item['view_count']:,} | {item['title']} | [觀看影片]({item['url']}) |\n")
            
    print("\n結果已儲存至 top_100_videos.json 和 top_100_videos.md")

if __name__ == '__main__':
    main()
