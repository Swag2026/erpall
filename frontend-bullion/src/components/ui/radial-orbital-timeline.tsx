"use client";
import { useState, useEffect, useRef } from "react";
import { ArrowRight, Link, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface TimelineItem {
  id: number;
  title: string;
  date: string;
  content: string;
  category: string;
  icon: React.ElementType;
  relatedIds: number[];
  status: "completed" | "in-progress" | "pending";
  energy: number;
}

interface RadialOrbitalTimelineProps {
  timelineData: TimelineItem[];
}

export default function RadialOrbitalTimeline({
  timelineData,
}: RadialOrbitalTimelineProps) {
  const [expandedItems, setExpandedItems] = useState<Record<number, boolean>>(
    {}
  );
  // Phone screens need a noticeably smaller orbit and a shorter panel —
  // the desktop sizing (260px radius, 760px tall) overflows a ~375px-wide
  // viewport and leaves an awkwardly tall empty block on mobile.
  const [viewportWidth, setViewportWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1024
  );
  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const isPhone = viewportWidth < 480;
  const orbitRadius = isPhone ? 110 : viewportWidth < 768 ? 170 : 260;
  const panelHeight = isPhone ? 420 : viewportWidth < 768 ? 560 : 760;
  const orbCore = isPhone ? 46 : viewportWidth < 768 ? 68 : 96; // central pulsing orb, scales with orbitRadius
  const nodeSize = isPhone ? 36 : 56; // each timeline stop's icon circle
  const [viewMode, setViewMode] = useState<"orbital">("orbital");
  const [rotationAngle, setRotationAngle] = useState<number>(0);
  const [autoRotate, setAutoRotate] = useState<boolean>(true);
  const [pulseEffect, setPulseEffect] = useState<Record<number, boolean>>({});
  const [centerOffset, setCenterOffset] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const [activeNodeId, setActiveNodeId] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const orbitRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === containerRef.current || e.target === orbitRef.current) {
      setExpandedItems({});
      setActiveNodeId(null);
      setPulseEffect({});
      setAutoRotate(true);
    }
  };

  const toggleItem = (id: number) => {
    setExpandedItems((prev) => {
      const newState = { ...prev };
      Object.keys(newState).forEach((key) => {
        if (parseInt(key) !== id) {
          newState[parseInt(key)] = false;
        }
      });

      newState[id] = !prev[id];

      if (!prev[id]) {
        setActiveNodeId(id);
        setAutoRotate(false);

        const relatedItems = getRelatedItems(id);
        const newPulseEffect: Record<number, boolean> = {};
        relatedItems.forEach((relId) => {
          newPulseEffect[relId] = true;
        });
        setPulseEffect(newPulseEffect);

        centerViewOnNode(id);
      } else {
        setActiveNodeId(null);
        setAutoRotate(true);
        setPulseEffect({});
      }

      return newState;
    });
  };

  useEffect(() => {
    let rotationTimer: NodeJS.Timeout;

    if (autoRotate && viewMode === "orbital") {
      rotationTimer = setInterval(() => {
        setRotationAngle((prev) => {
          const newAngle = (prev + 0.3) % 360;
          return Number(newAngle.toFixed(3));
        });
      }, 50);
    }

    return () => {
      if (rotationTimer) {
        clearInterval(rotationTimer);
      }
    };
  }, [autoRotate, viewMode]);

  const centerViewOnNode = (nodeId: number) => {
    if (viewMode !== "orbital" || !nodeRefs.current[nodeId]) return;

    const nodeIndex = timelineData.findIndex((item) => item.id === nodeId);
    const totalNodes = timelineData.length;
    const targetAngle = (nodeIndex / totalNodes) * 360;

    setRotationAngle(270 - targetAngle);
  };

  const calculateNodePosition = (index: number, total: number) => {
    const angle = ((index / total) * 360 + rotationAngle) % 360;
    const radius = orbitRadius;
    const radian = (angle * Math.PI) / 180;

    const x = radius * Math.cos(radian) + centerOffset.x;
    const y = radius * Math.sin(radian) + centerOffset.y;

    const zIndex = Math.round(100 + 50 * Math.cos(radian));
    const opacity = Math.max(
      0.4,
      Math.min(1, 0.4 + 0.6 * ((1 + Math.sin(radian)) / 2))
    );

    return { x, y, angle, zIndex, opacity };
  };

  const getRelatedItems = (itemId: number): number[] => {
    const currentItem = timelineData.find((item) => item.id === itemId);
    return currentItem ? currentItem.relatedIds : [];
  };

  const isRelatedToActive = (itemId: number): boolean => {
    if (!activeNodeId) return false;
    const relatedItems = getRelatedItems(activeNodeId);
    return relatedItems.includes(itemId);
  };

  const getStatusStyles = (status: TimelineItem["status"]): string => {
    switch (status) {
      case "completed":
        return "text-black bg-[#D4AA30] border-[#D4AA30]";
      case "in-progress":
        return "text-black bg-[#F2CA4C] border-[#AF8C28]";
      case "pending":
        return "text-[var(--cream-faint)] bg-[var(--surface-2)] border-[#D4AA30]/30";
      default:
        return "text-[var(--cream-faint)] bg-[var(--surface-2)] border-[#D4AA30]/30";
    }
  };

  return (
    <div
      className="w-full flex flex-col items-center justify-center bg-[var(--surface)] overflow-hidden rounded-lg"
      style={{ height: panelHeight }}
      ref={containerRef}
      onClick={handleContainerClick}
    >
      <div className="relative w-full max-w-4xl h-full flex items-center justify-center">
        <div
          className="absolute w-full h-full flex items-center justify-center"
          ref={orbitRef}
          style={{
            perspective: "1000px",
            transform: `translate(${centerOffset.x}px, ${centerOffset.y}px)`,
          }}
        >
          <div
            className="absolute rounded-full bg-gradient-to-br from-[#F2CA4C] via-[#D4AA30] to-[#AF8C28] animate-pulse flex items-center justify-center z-10"
            style={{ width: orbCore, height: orbCore }}
          >
            <div className="absolute rounded-full border border-[#D4AA30]/30 animate-ping opacity-70" style={{ width: orbCore * 1.33, height: orbCore * 1.33 }}></div>
            <div
              className="absolute rounded-full border border-[#D4AA30]/20 animate-ping opacity-50"
              style={{ width: orbCore * 1.67, height: orbCore * 1.67, animationDelay: "0.5s" }}
            ></div>
            <div className="rounded-full bg-[#F2CA4C]/90 backdrop-blur-md" style={{ width: orbCore * 0.5, height: orbCore * 0.5 }}></div>
          </div>

          <div className="absolute rounded-full border border-[#D4AA30]/15" style={{ width: orbitRadius * 2, height: orbitRadius * 2 }}></div>

          {timelineData.map((item, index) => {
            const position = calculateNodePosition(index, timelineData.length);
            const isExpanded = expandedItems[item.id];
            const isRelated = isRelatedToActive(item.id);
            const isPulsing = pulseEffect[item.id];
            const Icon = item.icon;

            const nodeStyle = {
              transform: `translate(${position.x}px, ${position.y}px)`,
              zIndex: isExpanded ? 200 : position.zIndex,
              opacity: isExpanded ? 1 : position.opacity,
            };

            return (
              <div
                key={item.id}
                ref={(el) => (nodeRefs.current[item.id] = el)}
                className="absolute transition-all duration-700 cursor-pointer"
                style={nodeStyle}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleItem(item.id);
                }}
              >
                <div
                  className={`absolute rounded-full -inset-1 ${
                    isPulsing ? "animate-pulse duration-1000" : ""
                  }`}
                  style={{
                    background: `radial-gradient(circle, rgba(212,170,48,0.25) 0%, rgba(212,170,48,0) 70%)`,
                    width: `${item.energy * (isPhone ? 0.4 : 0.7) + nodeSize}px`,
                    height: `${item.energy * (isPhone ? 0.4 : 0.7) + nodeSize}px`,
                    left: `-${(item.energy * (isPhone ? 0.4 : 0.7)) / 2}px`,
                    top: `-${(item.energy * (isPhone ? 0.4 : 0.7)) / 2}px`,
                  }}
                ></div>

                <div
                  className={`
                  rounded-full flex items-center justify-center
                  ${
                    isExpanded
                      ? "bg-[#D4AA30] text-black"
                      : isRelated
                      ? "bg-[#D4AA30]/50 text-black"
                      : "bg-[var(--surface)] text-[#D4AA30]"
                  }
                  border-2 
                  ${
                    isExpanded
                      ? "border-[#F2CA4C] shadow-lg shadow-[#D4AA30]/40"
                      : isRelated
                      ? "border-[#D4AA30] animate-pulse"
                      : "border-[#D4AA30]/40"
                  }
                  transition-all duration-300 transform
                  ${isExpanded ? "scale-150" : ""}
                `}
                  style={{ width: nodeSize, height: nodeSize }}
                >
                  <Icon size={isPhone ? 14 : 22} />
                </div>

                <div
                  className={`
                  absolute top-16  whitespace-nowrap
                  text-sm font-semibold tracking-wider
                  transition-all duration-300
                  ${isExpanded ? "text-[#F2CA4C] scale-125" : "text-[var(--cream-dim)]"}
                `}
                >
                  {item.title}
                </div>

                {isExpanded && (
                  <Card className={`absolute top-24 left-1/2 -translate-x-1/2 ${isPhone ? 'w-56' : 'w-80'} bg-[var(--surface)] backdrop-blur-lg border-[#D4AA30]/40 shadow-xl shadow-[#D4AA30]/10 overflow-visible`}>
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 w-px h-3 bg-[#D4AA30]/60"></div>
                    <CardHeader className="pb-2">
                      <div className="flex justify-between items-center">
                        <Badge
                          className={`px-2 text-xs ${getStatusStyles(
                            item.status
                          )}`}
                        >
                          {item.status === "completed"
                            ? "COMPLETE"
                            : item.status === "in-progress"
                            ? "IN PROGRESS"
                            : "PENDING"}
                        </Badge>
                        <span className="text-xs font-mono text-[var(--cream-faint)]">
                          {item.date}
                        </span>
                      </div>
                      <CardTitle className="text-base mt-2 text-[var(--cream)]">
                        {item.title}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-xs text-[var(--cream-dim)]">
                      <p>{item.content}</p>

                      <div className="mt-4 pt-3 border-t border-[#D4AA30]/20">
                        <div className="flex justify-between items-center text-xs mb-1">
                          <span className="flex items-center">
                            <Zap size={10} className="mr-1" />
                            Energy Level
                          </span>
                          <span className="font-mono">{item.energy}%</span>
                        </div>
                        <div className="w-full h-1 bg-[#D4AA30]/10 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-[#AF8C28] to-[#F2CA4C]"
                            style={{ width: `${item.energy}%` }}
                          ></div>
                        </div>
                      </div>

                      {item.relatedIds.length > 0 && (
                        <div className="mt-4 pt-3 border-t border-[#D4AA30]/20">
                          <div className="flex items-center mb-2">
                            <Link size={10} className="text-[#D4AA30]/80 mr-1" />
                            <h4 className="text-xs uppercase tracking-wider font-medium text-[var(--cream-faint)]">
                              Connected Nodes
                            </h4>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {item.relatedIds.map((relatedId) => {
                              const relatedItem = timelineData.find(
                                (i) => i.id === relatedId
                              );
                              return (
                                <Button
                                  key={relatedId}
                                  variant="outline"
                                  size="sm"
                                  className="flex items-center h-6 px-2 py-0 text-xs rounded-none border-[#D4AA30]/30 bg-transparent hover:bg-[#D4AA30]/10 text-[var(--cream-dim)] hover:text-[#F2CA4C] transition-all"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleItem(relatedId);
                                  }}
                                >
                                  {relatedItem?.title}
                                  <ArrowRight
                                    size={8}
                                    className="ml-1 text-[#D4AA30]/70"
                                  />
                                </Button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
