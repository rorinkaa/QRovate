import os from 'os';
export function resolveBaseUrl(){
  if(process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, '');
  const nets = os.networkInterfaces();
  for(const name of Object.keys(nets)){
    for(const net of nets[name]||[]){
      if(net.family==='IPv4' && !net.internal){
        return `http://${net.address}:4000`;
      }
    }
  }
  return 'http://localhost:4000';
}
