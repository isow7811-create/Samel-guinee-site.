import {createClient} from "https://esm.sh/@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 try{
  const auth=req.headers.get("Authorization")||"";
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const token=auth.replace("Bearer ","");const {data:{user},error}=await admin.auth.getUser(token);if(error||!user)throw new Error("Authentification requise");
  const {data:profile}=await admin.from("profiles").select("role").eq("user_id",user.id).single();if(profile?.role!=="super_admin")throw new Error("Seul le Super administrateur peut créer des administrateurs.");
  const {email,password}=await req.json();if(!email||!password||password.length<12)throw new Error("E-mail requis et mot de passe de 12 caractères minimum.");
  const {data,error:createError}=await admin.auth.admin.createUser({email,password,email_confirm:false});if(createError)throw createError;
  const {error:profileError}=await admin.from("profiles").insert({user_id:data.user.id,role:"admin"});if(profileError)throw profileError;
  return new Response(JSON.stringify({created:true}),{headers:{...cors,"Content-Type":"application/json"}});
 }catch(e){return new Response(JSON.stringify({error:e.message}),{status:403,headers:{...cors,"Content-Type":"application/json"}});}
});
