import { useEffect, useState } from "react"
import { motion, Variants } from "framer-motion"

import { cn } from "@/lib/utils"

interface TypewriterProps {
  text: string | string[]
  speed?: number
  initialDelay?: number
  waitTime?: number
  deleteSpeed?: number
  loop?: boolean
  className?: string
  showCursor?: boolean
  hideCursorOnType?: boolean
  cursorChar?: string | React.ReactNode
  cursorAnimationVariants?: {
    initial: Variants["initial"]
    animate: Variants["animate"]
  }
  cursorClassName?: string
}

const Typewriter = ({
  text,
  speed = 50,
  initialDelay = 0,
  waitTime = 2000,
  deleteSpeed = 30,
  loop = true,
  className,
  showCursor = true,
  hideCursorOnType = false,
  cursorChar = "|",
  cursorClassName = "ml-1",
  cursorAnimationVariants = {
    initial: { opacity: 0 },
    animate: {
      opacity: 1,
      transition: {
        duration: 0.01,
        repeat: Infinity,
        repeatDelay: 0.4,
        repeatType: "reverse",
      },
    },
  },
}: TypewriterProps) => {
  const [displayText, setDisplayText] = useState("")
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isDeleting, setIsDeleting] = useState(false)
  const [currentTextIndex, setCurrentTextIndex] = useState(0)

  const texts = Array.isArray(text) ? text : [text]

  useEffect(() => {
    let timeout: NodeJS.Timeout

    const currentText = texts[currentTextIndex]

    const startTyping = () => {
      if (isDeleting) {
        if (displayText === "") {
          setIsDeleting(false)
          if (currentTextIndex === texts.length - 1 && !loop) {
            return
          }
          setCurrentTextIndex((prev) => (prev + 1) % texts.length)
          setCurrentIndex(0)
          timeout = setTimeout(() => {}, waitTime)
        } else {
          timeout = setTimeout(() => {
            setDisplayText((prev) => prev.slice(0, -1))
          }, deleteSpeed)
        }
      } else {
        if (currentIndex < currentText.length) {
          timeout = setTimeout(() => {
            setDisplayText((prev) => prev + currentText[currentIndex])
            setCurrentIndex((prev) => prev + 1)
          }, speed)
        } else if (texts.length > 1) {
          timeout = setTimeout(() => {
            setIsDeleting(true)
          }, waitTime)
        }
      }
    }

    // Apply initial delay only at the start
    if (currentIndex === 0 && !isDeleting && displayText === "") {
      timeout = setTimeout(startTyping, initialDelay)
    } else {
      startTyping()
    }

    return () => clearTimeout(timeout)
  }, [
    currentIndex,
    displayText,
    isDeleting,
    speed,
    deleteSpeed,
    waitTime,
    texts,
    currentTextIndex,
    loop,
  ])

  // Layout-stable: every phrase is rendered once, invisibly, in the SAME grid
  // cell as the live typing layer, so the box is always as wide/tall as the
  // longest phrase. Without this the container grew letter by letter, and
  // in Arabic (RTL) that dragged the page title sideways while typing.
  return (
    <div
      className={`whitespace-pre-wrap tracking-tight ${className ?? ""}`}
      style={{ display: "inline-grid", maxWidth: "100%", verticalAlign: "top" }}
    >
      {texts.map((tx, i) => (
        <span
          key={i}
          aria-hidden="true"
          style={{ gridArea: "1 / 1", visibility: "hidden", pointerEvents: "none" }}
        >
          {tx}
        </span>
      ))}
      <div style={{ gridArea: "1 / 1" }}>
        <span>{displayText}</span>
        {showCursor && (
          <motion.span
            variants={cursorAnimationVariants}
            className={cn(
              cursorClassName,
              hideCursorOnType &&
                (currentIndex < texts[currentTextIndex].length || isDeleting)
                ? "hidden"
                : ""
            )}
            initial="initial"
            animate="animate"
          >
            {cursorChar}
          </motion.span>
        )}
      </div>
    </div>
  )
}

export { Typewriter }
