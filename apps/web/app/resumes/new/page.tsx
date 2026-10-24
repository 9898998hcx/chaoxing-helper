import { redirect } from 'next/navigation';
export default async function NewResumePage({searchParams}:{searchParams:Promise<{templateId?:string}>}){const params=await searchParams;redirect(`/resumes?new=1${params.templateId?`&templateId=${encodeURIComponent(params.templateId)}`:''}`);}
