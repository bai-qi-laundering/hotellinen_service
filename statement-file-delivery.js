// 把對帳單交到使用者手上。電腦直接下載或列印；手機用系統分享表（傳 LINE）。
// 必須在點擊處理函式裡同步呼叫，不能先 await，否則 iOS Safari 會關掉這次手勢。

export function isPhoneShareDevice(nav = globalThis.navigator) {
    if (!nav) return false;
    const ua = String(nav.userAgent || '');
    if (/iPhone|iPod|iPad|Android/i.test(ua)) return true;
    // iPadOS 13+（以及手機的「要求桌面版網站」）會偽裝成 Mac，但觸控點數不是 0。
    if (String(nav.platform || '') === 'MacIntel' && Number(nav.maxTouchPoints) > 1) return true;
    if (nav.userAgentData?.mobile === true) return true;
    return false;
}

function isAbort(error) {
    return error?.name === 'AbortError';
}

/**
 * 同步開始交出檔案，回傳的 Promise 在分享結束（或下載／列印已啟動）後完成。
 * 手機分享除了使用者取消（AbortError）以外的失敗，都改下載，不把錯誤丟出去。
 */
export function handoffStatementFile({
    format,
    mobile = false,
    file,
    filename,
    download,
    print,
    share,
    canShare,
} = {}) {
    if (format === 'pdf') {
        if (typeof print !== 'function') throw new Error('這台裝置無法開啟列印。');
        print();
        return Promise.resolve();
    }

    const save = () => {
        if (typeof download !== 'function') throw new Error('這台裝置無法下載 Excel。');
        download();
    };

    // 桌面 Chrome / Edge 的 canShare 對 .xlsx 會回 true，但 share() 會丟 NotAllowedError。
    // 電腦一律下載，不要開分享表。
    if (!mobile) {
        save();
        return Promise.resolve();
    }

    const payload = { files: file ? [file] : [], title: filename || '' };
    let allowed = typeof share === 'function';
    if (allowed && typeof canShare === 'function') {
        try { allowed = canShare(payload) === true; }
        catch { allowed = false; }
    }
    if (!allowed) {
        save();
        return Promise.resolve();
    }

    let sharing;
    try {
        sharing = share(payload);
    } catch (error) {
        if (isAbort(error)) return Promise.resolve();
        save();
        return Promise.resolve();
    }

    return Promise.resolve(sharing).then(() => {}, error => {
        if (isAbort(error)) return;
        save();
    });
}
