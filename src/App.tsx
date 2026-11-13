import { useEffect, useRef, useState } from 'react'
import Peer, { type DataConnection, type MediaConnection } from 'peerjs'
import { QRCodeSVG } from 'qrcode.react'

type Effect = {
  id: number
  text: string
  x: number
}

const targetPcId = new URLSearchParams(window.location.search).get('pc')

function VideoPanel({
  stream,
  effects,
  muted = false,
  onTap,
}: {
  stream: MediaStream | null
  effects: Effect[]
  muted?: boolean
  onTap?: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream
    }
  }, [stream])

  return (
    <div
      className="relative w-full overflow-hidden rounded-xl bg-black [container-type:inline-size]"
      onClick={onTap}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className="aspect-video w-full object-cover"
      />
      {effects.map((effect) => (
        <span
          key={effect.id}
          className="pointer-events-none absolute top-[70%] animate-[floatUp_1s_ease-out_forwards] whitespace-nowrap text-[6cqw] font-bold text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]"
          style={{ left: `${effect.x}%` }}
        >
          {effect.text}
        </span>
      ))}
    </div>
  )
}

function PcView() {
  const [myId, setMyId] = useState('')
  const [streams, setStreams] = useState<Record<string, MediaStream>>({})
  const [effects, setEffects] = useState<Record<string, Effect[]>>({})

  useEffect(() => {
    const peer = new Peer()

    const removePeer = (peerId: string) => {
      setStreams((prev) => {
        const next = { ...prev }
        delete next[peerId]
        return next
      })
    }

    peer.on('open', (id) => setMyId(id))

    peer.on('call', (call: MediaConnection) => {
      call.answer()
      call.on('stream', (remoteStream) => {
        setStreams((prev) => ({ ...prev, [call.peer]: remoteStream }))
      })
      call.on('close', () => removePeer(call.peer))
      call.on('error', () => removePeer(call.peer))
      call.peerConnection?.addEventListener('iceconnectionstatechange', () => {
        const state = call.peerConnection.iceConnectionState
        if (state === 'disconnected' || state === 'failed' || state === 'closed') {
          removePeer(call.peer)
        }
      })
    })

    peer.on('connection', (conn: DataConnection) => {
      conn.on('data', (data) => {
        const effect: Effect = {
          id: Date.now() + Math.random(),
          text: String(data),
          x: 20 + Math.random() * 60,
        }
        setEffects((prev) => ({
          ...prev,
          [conn.peer]: [...(prev[conn.peer] ?? []), effect],
        }))
      })
      conn.on('close', () => removePeer(conn.peer))
    })

    return () => {
      peer.destroy()
    }
  }, [])

  const phoneUrl = myId
    ? `${window.location.origin}${window.location.pathname}?pc=${myId}`
    : ''
  const peerIds = Object.keys(streams)

  return (
    <div className="min-h-screen bg-slate-900 p-6 text-white">
      <h1 className="mb-4 text-2xl font-bold">PC画面</h1>

      <div className="mb-6 flex flex-wrap items-center gap-6">
        <div className="rounded-xl bg-white p-3">
          {phoneUrl ? (
            <QRCodeSVG value={phoneUrl} size={160} />
          ) : (
            <p className="text-black">接続中…</p>
          )}
        </div>
        <div className="space-y-2">
          <p>Peer ID：{myId || '取得中…'}</p>
          <p>接続台数：{peerIds.length}台</p>
          <p className="text-sm text-slate-400">スマホでQRコードを読み取ってください</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {peerIds.map((peerId) => (
          <VideoPanel
            key={peerId}
            stream={streams[peerId]}
            effects={effects[peerId] ?? []}
            muted
          />
        ))}
      </div>
    </div>
  )
}

function PhoneView({ target }: { target: string }) {
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [status, setStatus] = useState('カメラを準備中…')
  const [text, setText] = useState('いいね！')
  const connRef = useRef<DataConnection | null>(null)

  useEffect(() => {
    let peer: Peer | null = null
    let localStream: MediaStream | null = null
    let cancelled = false

    if (!navigator.mediaDevices) {
      setStatus('カメラを使えません（HTTPSで開いてください）')
      return
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        localStream = s
        setStream(s)
        setStatus('PCに接続中…')

        const p = new Peer()
        peer = p
        p.on('open', () => {
          p.call(target, s)
          const conn = p.connect(target)
          conn.on('open', () => {
            connRef.current = conn
            setStatus('接続しました')
          })
          conn.on('close', () => setStatus('切断されました'))
        })
        p.on('error', (err) => setStatus(`エラー：${err.type}`))
      })
      .catch(() => setStatus('カメラの使用が許可されませんでした'))

    return () => {
      cancelled = true
      peer?.destroy()
      localStream?.getTracks().forEach((t) => t.stop())
    }
  }, [target])

  const send = () => {
    const message = text.trim()
    if (message && connRef.current?.open) {
      connRef.current.send(message)
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 p-4 text-white">
      <h1 className="mb-2 text-xl font-bold">スマホ画面</h1>
      <p className="mb-4 text-sm text-slate-300">{status}</p>

      <VideoPanel stream={stream} effects={[]} muted onTap={send} />

      <div className="mt-4 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="flex-1 rounded-lg px-3 py-2 text-black"
          placeholder="送る文字"
        />
        <button onClick={send} className="rounded-lg bg-blue-600 px-4 py-2 font-bold">
          送信
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-400">映像をタップしても送信できます</p>
    </div>
  )
}

function App() {
  return targetPcId ? <PhoneView target={targetPcId} /> : <PcView />
}

export default App