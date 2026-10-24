import { TemplateDetail } from '../../../components/templates';
export const metadata={title:'模板结构详情'};
export default async function TemplatePage({params}:{params:Promise<{id:string}>}){const{id}=await params;return <TemplateDetail id={id}/>;}
