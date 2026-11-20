import { useEffect, useRef, useState } from 'react'
import Peer, { type DataConnection, type MediaConnection } from 'peerjs'
import { QRCodeSVG } from 'qrcode.react'
import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision'

type Effect = {
  id: number
  text: string
  x: number
}

const targetPcId = new URLSearchParams(window.location.search).get('pc')

let detectorPromise: Promise<FaceDetector> | null = null

function getDetector() {
  if (!detectorPromise) {
    detectorPromise = FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm',
    ).then((fileset) =>
      FaceDetector.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
      }),
    )
  }
  return detectorPromise
}

function drawSunglasses(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  bx: number,
  by: number,
) {
  if (ax > bx) {
    ;[ax, bx] = [bx, ax]
    ;[ay, by] = [by, ay]
  }
  const d = Math.hypot(bx - ax, by - ay)
  const cx = (ax + bx) / 2
  const cy = (ay + by) / 2
  const angle = Math.atan2(by - ay, bx - ax)
  const lensW = d * 0.9
  const lensH = d * 0.6

  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(angle)

  ctx.fillStyle = 'rgba(10, 10, 10, 0.92)'
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.roundRect(side * (d / 2) - lensW / 2, -lensH / 2, lensW, lensH, lensH * 0.4)
    ctx.fill()
  }

  ctx.strokeStyle = '#111'
  ctx.lineWidth = Math.max(2, d * 0.08)
  ctx.beginPath()
  ctx.moveTo(-d / 2 + lensW / 2, -lensH * 0.2)
  ctx.lineTo(d / 2 - lensW / 2, -lensH * 0.2)
  ctx.stroke()

  ctx.fillStyle = 'rgba(255, 255, 255, 0.3)'
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.ellipse(side * (d / 2) - lensW * 0.2, -lensH * 0.15, lensW * 0.12, lensH * 0.08, -0.4, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.restore()
}

function VideoPanel({
  stream,
  effects,
  muted = false,
  sunglasses = false,
  onTap,
}: {
  stream: MediaStream | null
  effects: Effect[]
  muted?: boolean
  sunglasses?: boolean
  onTap?: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream
    }
  }, [stream])

  useEffect(() => {
    const clear = () => {
      const canvas = canvasRef.current
      canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    }

    if (!sunglasses) {
      clear()
      return
    }

    let stopped = false
    let rafId = 0

    getDetector().then((detector) => {
      const loop = () => {
        if (stopped) return
        const video = videoRef.current
        const canvas = canvasRef.current
        const ctx = canvas?.getContext('2d')

        if (video && canvas && ctx && video.readyState >= 2 && video.videoWidth > 0) {
          const cw = canvas.clientWidth
          const ch = canvas.clientHeight
          if (canvas.width !== cw) canvas.width = cw
          if (canvas.height !== ch) canvas.height = ch
          ctx.clearRect(0, 0, cw, ch)

          const vw = video.videoWidth
          const vh = video.videoHeight
          const scale = Math.max(cw / vw, ch / vh)
          const ox = (cw - vw * scale) / 2
          const oy = (ch - vh * scale) / 2

          const result = detector.detectForVideo(video, performance.now())
          for (const detection of result.detections) {
            const [eye1, eye2] = detection.keypoints
            if (!eye1 || !eye2) continue
            drawSunglasses(
              ctx,
              ox + eye1.x * vw * scale,
              oy + eye1.y * vh * scale,
              ox + eye2.x * vw * scale,
              oy + eye2.y * vh * scale,
            )
          }
        }
        rafId = requestAnimationFrame(loop)
      }
      loop()
    })

    return () => {
      stopped = true
      cancelAnimationFrame(rafId)
      clear()
    }
  }, [sunglasses])

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
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
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
  const [sunglasses, setSunglasses] = useState(false)

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
          <button
            onClick={() => setSunglasses((v) => !v)}
            className={`rounded-lg px-4 py-2 font-bold ${sunglasses ? 'bg-yellow-400 text-black' : 'bg-slate-700'}`}
          >
            😎 サングラス {sunglasses ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {peerIds.map((peerId) => (
          <VideoPanel
            key={peerId}
            stream={streams[peerId]}
            effects={effects[peerId] ?? []}
            sunglasses={sunglasses}
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