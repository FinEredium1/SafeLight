const jwt = require('jsonwebtoken')

function auth_middleware(req, res, next){
    const header = req.headers['authorization'];

    if (!header || !header.startsWith("Bearer ")){
        return res.status(401).json({error : "Malformed or missing token"});
    }

    const token = header.slice(7)

    try{
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        req.user = {id: payload.sub};
        next();
    } catch (err){
        return res.status(401).json({error : "Invalid or expired token"})
    }

    module.exports = auth_middleware;
}