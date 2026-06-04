FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 CMD node -e "const http=require('http'); const port=process.env.DASHBOARD_PORT||process.env.PORT||3001; const req=http.get({host:'127.0.0.1',port,path:'/healthz',timeout:5000},res=>process.exit(res.statusCode===200?0:1)); req.on('error',()=>process.exit(1)); req.on('timeout',()=>{req.destroy(); process.exit(1);});"

CMD ["npm", "start"]
