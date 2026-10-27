import { ImagesBadge } from "@/components/ui/images-badge";

const images = [
  {
    src: "https://cdn.21st.dev/assets/mirror/b7/b75cc2fc7e8c4da568934effe9524ddc32bc80a2dcdb5009ff642380d7f6b904.svg",
    alt: "Alpha",
  },
  {
    src: "https://cdn.21st.dev/assets/mirror/78/78f0b9a9aa207930b9684faece4e4d0033f22c7a6afef8fa0f3fb7f16e00f935.svg",
    alt: "Beta",
  },
  {
    src: "https://cdn.21st.dev/assets/mirror/52/5265e325bc7c8eeeb92a683747688382fadeeeef1cf0efbe7667129c4f58cbc9.svg",
    alt: "Gamma",
  },
  {
    src: "https://cdn.21st.dev/assets/mirror/5f/5f93a4060ce99f2e7f202b97b78e49d570bb804061830f68d6979bd198c71a9a.svg",
    alt: "Delta",
  },
  {
    src: "https://cdn.21st.dev/assets/mirror/93/93df5c0062252f382b94884ec8abdd1b257bc0ec345515e55470d72efded4e03.svg",
    alt: "Epsilon",
  },
  {
    src: "https://cdn.21st.dev/assets/mirror/01/015a963a0572cd2f884758e6269afbc305f7a2fdf9c0b89ce034f71072e3eac1.svg",
    alt: "Zeta",
  },
];

export default function ImagesBadgeDemo() {
  return (
    <div className="flex min-h-[220px] items-center justify-center">
      <ImagesBadge images={images} label="Introducing Marketing Template" />
    </div>
  );
}
