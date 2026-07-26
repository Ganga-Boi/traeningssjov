import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Træningssjov",
  description: "Fremmøde, klippekort og betaling samlet ét sted.",
};

const criticalCss = `
*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#f4f6f2;color:#17342b;font-family:Arial,Helvetica,sans-serif}button,input{font:inherit}button{cursor:pointer}
[class~="min-h-screen"]{min-height:100vh}[class~="h-full"]{height:100%}[class~="min-h-full"]{min-height:100%}
[class~="bg-[#f4f6f2]"]{background:#f4f6f2}[class~="bg-white"]{background:#fff}[class~="bg-[#17342b]"]{background:#17342b}[class~="bg-[#28755d]"]{background:#28755d}[class~="bg-[#e8f1ec]"]{background:#e8f1ec}[class~="bg-[#fff0d8]"]{background:#fff0d8}[class~="bg-[#fee9e5]"]{background:#fee9e5}[class~="bg-black/40"]{background:rgba(0,0,0,.4)}
[class~="text-[#17342b]"]{color:#17342b}[class~="text-[#28755d]"]{color:#28755d}[class~="text-[#6b837a]"]{color:#6b837a}[class~="text-[#8b5605]"]{color:#8b5605}[class~="text-[#8d342d]"]{color:#8d342d}[class~="text-white"]{color:#fff}[class~="text-transparent"]{color:transparent}
[class~="mx-auto"]{margin-left:auto;margin-right:auto}[class~="mt-0.5"]{margin-top:.125rem}[class~="mt-1"]{margin-top:.25rem}[class~="mt-2"]{margin-top:.5rem}[class~="mt-3"]{margin-top:.75rem}[class~="mt-4"]{margin-top:1rem}[class~="mt-5"]{margin-top:1.25rem}[class~="mt-6"]{margin-top:1.5rem}
[class~="px-2"]{padding-left:.5rem;padding-right:.5rem}[class~="px-3"]{padding-left:.75rem;padding-right:.75rem}[class~="px-4"]{padding-left:1rem;padding-right:1rem}[class~="px-5"]{padding-left:1.25rem;padding-right:1.25rem}[class~="py-1"]{padding-top:.25rem;padding-bottom:.25rem}[class~="py-1.5"]{padding-top:.375rem;padding-bottom:.375rem}[class~="py-2"]{padding-top:.5rem;padding-bottom:.5rem}[class~="py-3"]{padding-top:.75rem;padding-bottom:.75rem}[class~="py-4"]{padding-top:1rem;padding-bottom:1rem}[class~="py-7"]{padding-top:1.75rem;padding-bottom:1.75rem}[class~="py-12"]{padding-top:3rem;padding-bottom:3rem}[class~="p-3"]{padding:.75rem}[class~="p-4"]{padding:1rem}[class~="p-5"]{padding:1.25rem}[class~="pb-24"]{padding-bottom:6rem}[class~="pt-4"]{padding-top:1rem}
[class~="w-full"]{width:100%}[class~="max-w-xl"]{max-width:36rem}[class~="max-w-md"]{max-width:28rem}[class~="min-w-0"]{min-width:0}[class~="h-12"]{height:3rem}[class~="w-12"]{width:3rem}[class~="min-h-20"]{min-height:5rem}
[class~="flex"]{display:flex}[class~="block"]{display:block}[class~="grid"]{display:grid}[class~="items-center"]{align-items:center}[class~="items-start"]{align-items:flex-start}[class~="items-end"]{align-items:flex-end}[class~="justify-between"]{justify-content:space-between}[class~="justify-center"]{justify-content:center}[class~="flex-1"]{flex:1 1 0%}[class~="shrink-0"]{flex-shrink:0}[class~="gap-2"]{gap:.5rem}[class~="gap-3"]{gap:.75rem}[class~="gap-4"]{gap:1rem}[class~="space-y-3"]> *+*{margin-top:.75rem}
[class~="rounded-xl"]{border-radius:.75rem}[class~="rounded-2xl"]{border-radius:1rem}[class~="rounded-3xl"]{border-radius:1.5rem}[class~="rounded-full"]{border-radius:9999px}
[class~="border"]{border:1px solid #dce2da}[class~="border-2"]{border:2px solid #bdc9c2}[class~="border-b"]{border-bottom:1px solid #e8ece7}[class~="border-[#dce2da]"]{border-color:#dce2da}[class~="border-[#ccd6d0]"]{border-color:#ccd6d0}[class~="border-[#bdc9c2]"]{border-color:#bdc9c2}[class~="border-[#28755d]"]{border-color:#28755d}
[class~="shadow-sm"]{box-shadow:0 1px 3px rgba(23,52,43,.12)}[class~="shadow-xl"]{box-shadow:0 20px 35px rgba(0,0,0,.22)}[class~="overflow-hidden"]{overflow:hidden}[class~="truncate"]{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}[class~="divide-y"]>*+*{border-top:1px solid #edf0ec}
[class~="text-left"]{text-align:left}[class~="text-center"]{text-align:center}[class~="text-sm"]{font-size:.875rem}[class~="text-xs"]{font-size:.75rem}[class~="text-lg"]{font-size:1.125rem}[class~="text-xl"]{font-size:1.25rem}[class~="text-2xl"]{font-size:1.5rem}[class~="text-3xl"]{font-size:1.875rem}[class~="text-[11px]"]{font-size:11px}[class~="font-bold"]{font-weight:700}[class~="font-extrabold"]{font-weight:800}[class~="font-black"]{font-weight:900}[class~="uppercase"]{text-transform:uppercase}[class~="capitalize"]{text-transform:capitalize}[class*="tracking-"]{letter-spacing:.2em}
[class~="fixed"]{position:fixed}[class~="sticky"]{position:sticky}[class~="inset-0"]{inset:0}[class~="top-0"]{top:0}[class~="z-10"]{z-index:10}[class~="z-30"]{z-index:30}
[class~="outline-none"]{outline:none}[class~="disabled:opacity-40"]:disabled{opacity:.4}[class~="disabled:cursor-default"]:disabled{cursor:default}
input[type=date],input[type=text],input:not([type]){border:1px solid #ccd6d0;background:white;border-radius:1rem;padding:1rem;width:100%}
@media(min-width:640px){[class~="sm:items-center"]{align-items:center}[class~="sm:justify-center"]{justify-content:center}[class~="sm:max-w-md"]{max-width:28rem}}
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="da" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head><style dangerouslySetInnerHTML={{ __html: criticalCss }} /></head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
