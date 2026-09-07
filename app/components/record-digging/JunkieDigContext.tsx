'use client'

import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from 'react'

const HIDDEN_STORAGE_KEY = 'ms_junkie_dig_hidden'

// バナーの非表示状態はlocalStorage(タブ外部の状態)が真実のソースなので、
// useEffect+useStateで手動同期する代わりにuseSyncExternalStoreで購読する。
// これによりSSR時はgetServerSnapshotの値(常に表示)でハイドレーションし、
// クライアント側の実値へは警告なしで切り替わる。
const hiddenListeners = new Set<() => void>()

function subscribeHidden(callback: () => void) {
  hiddenListeners.add(callback)
  return () => hiddenListeners.delete(callback)
}

function getHiddenSnapshot(): boolean {
  try {
    return window.localStorage.getItem(HIDDEN_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function getHiddenServerSnapshot(): boolean {
  return false
}

function persistHidden() {
  try {
    window.localStorage.setItem(HIDDEN_STORAGE_KEY, '1')
  } catch {
    // 保存に失敗しても、今回の表示中だけは非表示のままにする
  }
  hiddenListeners.forEach((callback) => callback())
}

type JunkieDigContextValue = {
  /** モーダルを開いているか */
  open: boolean
  /** フローティングバナーを非表示にしたか(localStorageで端末に保存、次回訪問時も引き継ぐ) */
  hidden: boolean
  openJunkieDig: () => void
  closeJunkieDig: () => void
  /** バナーを非表示にする。モーダル自体はメニューからいつでも開けるようにするため、
   * open状態には影響しない。 */
  hideBanner: () => void
}

const JunkieDigContext = createContext<JunkieDigContextValue | null>(null)

export function JunkieDigProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const hidden = useSyncExternalStore(subscribeHidden, getHiddenSnapshot, getHiddenServerSnapshot)

  return (
    <JunkieDigContext.Provider
      value={{
        open,
        hidden,
        openJunkieDig: () => setOpen(true),
        closeJunkieDig: () => setOpen(false),
        hideBanner: persistHidden,
      }}
    >
      {children}
    </JunkieDigContext.Provider>
  )
}

export function useJunkieDig(): JunkieDigContextValue {
  const ctx = useContext(JunkieDigContext)
  if (!ctx) {
    throw new Error('useJunkieDig must be used within a JunkieDigProvider')
  }
  return ctx
}
