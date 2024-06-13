const path = require("path");
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const { init: initDB, Counter } = require("./db");
const axios = require('axios');
const crypto = require('crypto');
const logger = morgan("tiny");
const NodeCache = require( "node-cache" );
const { log } = require("console");

const appId = 'wx2f43f29ff9867f52'; //  'wxeb4ce15752cf1d30';
const appSecret = 'd17dc64b9d3b2de939e5fe293c229ed6'; // '8de5c379ac62cf9a5f25c607f7be6cc0';

// const appId2 = 'wxe78a01a0ffd9a5b8';
// const appSecret2 = 'f115cd0740649b4a4373a29cfb4dcf02';
// 填写你在微信公众平台上设置的 Token
const TOKEN = 'wincax';
let jsapiTicket = '';
let ticketExpires = 0;

// 使用 NodeCache 来缓存 access_token
const cache = new NodeCache({ checkperiod: 60 });

// 获取 access_token 的函数
const getAccessToken = async () => {
  const data = cache.get('access_token_id') || {};
  const { token} = data;
  if (token && data.appId === appId) {
    return token;
  }

  console.log('token:', token);
  try {
    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`;
    console.log('getAccessToken url ', url);
    const response = await axios.get(url);
    // {
    //     "access_token": "81_xwlntQYpIXVSZFQX9pPAOib_gCDLozS04CP1dmM50xvlYGbz33zIF7Ds0wDoDEe3DhcLQ4egki1_irgWPuOsh0nAqH2nvNiDo2kOT6UsxfXcGw6v8WO284Q6V1cKSJiAAAVDU", 
    //     "expires_in": 7199
    // }
    console.log('client_credential:', response.data);
    const { access_token, expires_in } = response.data;
    
  
    // 将 access_token 缓存，并设置为提前 300 秒刷新
    cache.set('access_token_id', {token: access_token, appId: appId}, expires_in - 300);
    return access_token;   
  } catch (error) {
    console.error('Error getting access_token:', error);
    return '';   
  }

};

// 定时刷新 access_token
const refreshToken = async () => {
  try {
    await getAccessToken();
  } catch (error) {
    console.error('Error refreshing access_token:', error);
  }
};

// 每 1 小时刷新一次
setInterval(refreshToken, 3600000);

const getJsapiTicket = async (accessToken) => {
  const response = await axios.get(`https://api.weixin.qq.com/cgi-bin/ticket/getticket?access_token=${accessToken}&type=jsapi`);
  console.log('getJsapiTicket:', response);
  return response.data.ticket;
};

const getSignature = (ticket, nonceStr, timestamp, url) => {
  // jsapi_ticket=sM4AOVdWfPE4DxkXGEs8VMCPGGVi4C3VM0P37wVUCFvkVAy_90u5h9nbSlYy3-Sl-HhTdfl2fzFy1AOcHKP7qg&noncestr=Wm3WZYTPz0wzccnW&timestamp=1414587457&url=http://mp.weixin.qq.com?params=value
  const string = `jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${url}`;
  return crypto.createHash('sha1').update(string).digest('hex');
};


const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cors());
app.use(logger);

// 首页
app.get("/", async (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// 更新计数
app.post("/api/count", async (req, res) => {
  const { action } = req.body;
  if (action === "inc") {
    await Counter.create();
  } else if (action === "clear") {
    await Counter.destroy({
      truncate: true,
    });
  }
  res.send({
    code: 0,
    data: await Counter.count(),
  });
});

// 获取计数
app.get("/api/count", async (req, res) => {
  const result = await Counter.count();
  res.send({
    code: 0,
    data: result,
  });
});

// 小程序调用，获取微信 Open ID
app.get("/api/wx_openid", async (req, res) => {
  if (req.headers["x-wx-source"]) {
    res.send(req.headers["x-wx-openid"]);
  }
});

// Endpoint to initiate WeChat OAuth
app.get('/auth/wechat', (req, res) => {
  const { code } = req.query;
  const url = `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${appId}&secret=${appSecret}&code=${code}&grant_type=authorization_code`;

  console.log('/auth/wechat:', url);

  // Exchange code for access token
  axios.get(url)
    .then(response => {
      const { access_token, openid } = response.data;
      console.log('openid:', response.data);
      // Here you have the openid, you can do further processing
      res.send({
        code: 0,
        data: {openid},
      });
    })
    .catch(error => {
      console.error('Error exchanging code for access token:', error.response.data);
      res.status(500).send('Error occurred');
    });
});

// 提供接口供其他业务服务器获取当前有效的 access_token
app.get('/getAccessToken', async (req, res) => {
  try {
    const token = await getAccessToken();
    res.send({
      code: 0,
      data: {access_token: token},
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get access_token' });
  }
});

// 被动刷新 access_token 的接口
app.get('/refreshAccessToken', async (req, res) => {
  try {
    const token = await getAccessToken();
    res.send({
      code: 0,
      data: {access_token: token},
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to refresh access_token' });
  }
});

// 验证微信服务器地址的有效性
app.get('/wechat', (req, res) => {
  const { signature, timestamp, nonce, echostr } = req.query;

  // 1. 将 token、timestamp、nonce 三个参数进行字典序排序
  const array = [TOKEN, timestamp, nonce].sort();
  const tempStr = array.join('');

  // 2. 将三个参数字符串拼接成一个字符串进行 sha1 加密
  const hashCode = crypto.createHash('sha1'); // 创建加密类型
  const resultCode = hashCode.update(tempStr, 'utf8').digest('hex'); // 对传入的字符串进行加密

  // 3. 开发者获得加密后的字符串可与 signature 对比，标识该请求来源于微信
  if (resultCode === signature) {
    res.send(echostr);
  } else {
    res.send('Invalid signature');
  }
});

app.get('/wx_config', async (req, res) => {
  const url = req.query.url;

  try {
    if (jsapiTicket === undefined || !jsapiTicket || Date.now() > ticketExpires) {
      const accessToken = await getAccessToken();
      jsapiTicket = await getJsapiTicket(accessToken);
      ticketExpires = Date.now() + 7000 * 1000; // 7000 seconds
    }
    console.log('jsapiTicket:', jsapiTicket);
    const nonceStr = Math.random().toString(36).substr(2, 15);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = getSignature(jsapiTicket, nonceStr, timestamp, url);
    res.send({
      code: 0,
      data: {appId: appId, timestamp, nonceStr, signature, url, ticket: jsapiTicket},
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get config' });
  }
});

app.get('/wx_openid', async (req, res) => {
  const redirectUri = req.query.url;

  try {
    const url = `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${appId}&redirect_uri=${redirectUri}&response_type=code&scope=snsapi_base&state=STATE#wechat_redirect`;
    axios.get(url, {
      maxRedirects: 0 // 不跟随任何重定向
    })
    .then(response => {
      // 检查响应状态码
      if (response.status === 302) {
        // 重定向的 URL 可以在 response.headers['location'] 中找到
        console.log('Redirected URL:', response.headers['location']);
        // const url = `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${appId}&secret=${appSecret}&code=${code}&grant_type=authorization_code`;
      }
      // Here you have the openid, you can do further processing
      res.send({
        code: 0,
        data: {}, // openid
      });
    })
    .catch(error => {
      console.error('Error exchanging code for openid:', error.response.data);
      res.status(500).send('Error occurred');
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get oppenid' });
  }
});

const port = process.env.PORT || 80;

async function bootstrap() {
  await initDB();
  app.listen(port, () => {
    console.log("启动成功", port);
  });
}

bootstrap();
