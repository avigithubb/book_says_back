import pg from "pg";
import bodyParser from "body-parser";
import express from "express"
import dotenv from 'dotenv';
import cors from "cors";
import session from "express-session";
import passport from "passport";
import { Strategy } from "passport-local";
import bcrypt from "bcryptjs";
import pkg from 'pg';
// import pkgs from "ioredis";
import connectRedis from "connect-redis";
import { createClient } from 'redis';



const app = express();
const port = 3000;
dotenv.config();
const saltRounds = 10;
const { Pool } = pkg;
// const {createClient} = pkgs;
const RedisStore = connectRedis(session);
const redisClient = createClient;



const db = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false, 
    },
});

redisClient.on('error', (err) => console.error('Redis client error', err));
await redisClient.connect().then(() => {
    console.log('Connected to Redis');
  }).catch((err) => {
    console.error('Could not connect to Redis', err);
  });

app.use(session({
    store: new RedisStore({ client: redisClient }),
    secret: process.env.SESSIONSECRET,
    resave: false,
    saveUninitialized: true,
    cookie: {
        maxAge: 1000 * 60 * 60 * 24,
        secure: process.env.NODE_ENV === 'production',  
        httpOnly: true
    }
}))

app.use(passport.initialize());
app.use(passport.session());

const corsOptions = {
  origin: "https://book-says-up.vercel.app/",
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
};


app.use(cors(corsOptions));


app.use(bodyParser.urlencoded({extended: false}));
app.use(express.static("public"));



// const db = new pg.Client({
//     user: process.env.USERNAME,
//     host: process.env.HOST,
//     database: process.env.DATABASE,
//     password: process.env.PASSWORD,
//     port: process.env.PORT
// });

// db.connect();


app.get("/", async(req, res) => {
    const users = await db.query("SELECT * FROM Users");
    
    return res.send(users.rows);
})

app.get("/search_user", async(req, res) => {
    try{
    const username = req.query.user;

    const user = await db.query("SELECT * from Users WHERE username = $1", [username]);

    res.send(user.rows);
    }
    catch(err){
        res.send({msg: "failure"});
    }
})
app.post("/register", async(req, res) =>{
    try{
        const name = req.query.name;
        const username = req.query.username;
        const email = req.query.email;
        const password = req.query.password;
        const collection = req.query.collection;
        const about = req.query.about;
        

        try{
            const checkResult = await db.query("SELECT * FROM Users WHERE email = $1", [email]);

            if(checkResult.rows.length > 0 ){
                res.send({msg: "failure"});
            }else{
                bcrypt.hash(password, saltRounds, async(err, hash) => {
                    if(err){
                        res.send({msg: "failure"});
                    }else{
                        const result = await db.query("INSERT INTO Users (name, username, email, password, collection, about) VALUES ( $1, $2, $3, $4, $5, $6 ) RETURNING *", [name, username, email, hash, collection, about]);
                        const user = result.rows[0];
                        
                        req.login(user, (err) => {
                            if (err) {
                                console.log(err);
                                return res.send({msg: "failure"});
                            }
                            res.redirect(`/secret?user=${user.username}&&isAuthenticated=${req.isAuthenticated()}`);
                        });
                    }
                })
            }
        }catch(err){
            console.log(err);
        }
      
        
    }
    catch(err){
        console.log(err);
        res.send({msg: "failure"});
    }
})

app.get("/get-user", async(req, res) =>{
    try{
        const username = req.query.username;
       

        const user = await db.query("SELECT * FROM Users WHERE username = $1", [username]);
        

        if(user.rows == ""){
            res.send({msg: "failure"});
        }else{
            res.send(user.rows);
        }
       

    }catch(err){
        console.log(err);
        res.send(JSON.stringify({msg: "failure"}));
    }


})

app.get("/get-user-books", async(req, res) =>{
    try{
        const username = req.query.username;
        

        const user = await db.query("SELECT * FROM Users WHERE username = $1", [username]);
        
        const user_data = await db.query("SELECT * FROM Users JOIN books ON Users.id = books.user_id WHERE Users.id = $1", [user.rows[0].id]);
        
        if(user_data.rows == ""){
            res.send({msg: "failure"});
        }else{
            res.send(user_data.rows);
        }
       

    }catch(err){
        console.log(err);
        res.send(JSON.stringify({msg: "failure"}));
    }


})

app.all("/get_book", async(req, res) => { 
    try{

        const bookIsbn = req.query.book_isbn;
        
        const book_data = await db.query("SELECT * FROM books WHERE isbn = $1", [bookIsbn]);
       
        if(book_data.rows == ""){
            res.send({msg: "failure"});
        }
        else{
            res.send(book_data.rows[0]);
            // res.send(book_data);
        }
    }
    catch(err){
        console.log(err);
        res.send({msg: "failure"});
    }
})

function saveSessionMiddleware(req, res, next) {    
    
    if (req.isAuthenticated()) {
        req.session.save((err) => {
            if (err) {
                console.log('Session save error:', err);
                return next(err);
            }
          
            console.log('Session saved successfully.');
            return next(); 
        });
    } else {
        return next();
    }
}

app.all("/login", 
    passport.authenticate("local", {
        failureRedirect: "/login"
    }),
    saveSessionMiddleware, 
    (req, res) => {
        res.redirect(`/secret?user=${req.user.username}&&isAuthenticated=${req.isAuthenticated()}`);
    }
);

app.get("/secret", (req, res) => {
    const user = req.query.user;
    const auth = req.query.isAuthenticated;
    
    if(auth){
        res.send({msg: "success", userName: user});
    }
    else{
        res.send({msg: "failure"});
    }
    
})


app.all("/logout", (req, res) =>{
    try{
        req.session.destroy();
        res.clearCookie('connect.sid')
        res.send({msg: "success"});
    }
    catch(err){
        res.send({msg: "failure"});
    }
    
})



app.all("/create", async(req, res) => {
 
        try{
            const user_id = req.query.user_id;
            const book_name = req.query.book_name;
            const author_name = req.query.author_name;
            const isbn = req.query.isbn;
            const description = req.query.description;
            const notes = req.query.my_notes;
            const cover = req.query.cover;
            const date = req.query.date;
            const rating = req.query.rating;
          

            await db.query("INSERT INTO books (book_name, author_name, isbn, description, notes, cover, date, rating, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ", [book_name.toUpperCase(), author_name.toUpperCase(), isbn, description, notes, cover, date, rating, user_id]);
          
            res.send({msg: "success"});
        }catch(error){
            
            res.send({msg: error.msg});
        }

    }
   
)


app.all("/update_book", async (req, res) => {
    

    try {
        const book_id = req.query.id;
        const book_name = req.query.book_name;
        const author_name = req.query.author_name;
        const isbn = req.query.isbn;
        const description = req.query.description;
        const notes = req.query.my_notes;
        const cover = req.query.cover;
        const date = req.query.date;
        const rating = req.query.rating;

      
    
        await db.query("UPDATE books SET book_name = $1, author_name=$2, isbn=$3, description=$4, notes=$5, cover=$6, date=$7, rating=$8 WHERE books_id = $9", [book_name, author_name, isbn, description, notes, cover, date, rating, book_id]);
        console.log("book updated");
        res.send({msg: "success"});
    } catch (error) {
        console.error("Error updating book:", error);
        res.status(500).send({msg: "failure"});
    }
});


app.get("/delete", async(req, res) =>{
   
    const book_name = req.query.book_name;
    const id = req.query.user_id;
    
    try {
        // Delete the book with the given id
        
        await db.query("DELETE FROM books WHERE user_id = $1 AND book_name = $2", [id, book_name]);
      

        res.send({msg: "success"});
    } catch (error) {
        console.error("Error deleting book or fetching user:", error);
        return res.status(500).send({msg: "failure"});
    }
})

passport.use(new Strategy(async function varify(username, password, cb){
    try{
 
        console.log(username+","+password);


        const result = await db.query("SELECT * FROM Users WHERE username = $1", [username]);
      
        if(result.rows.length > 0) {
            const user = result.rows[0];
            
            const storedHashedPassword = user.password;
            bcrypt.compare(password, storedHashedPassword, (err, result) => {
                if(err){
                    console.log(err);
                }
                else{
                    console.log(result);
                    if(result){
                        return cb(null, user);
                    }else{
                        return cb(null, false);
                    }
                }
            })
        }
        




    }catch(err){
        console.log(err);
        res.send({msg: "failure"});
    }
}))



passport.serializeUser(function(user, done) {
    done(null, user.id); 
});

passport.deserializeUser(function(id, done) {
    User.findById(id, function(err, user) {
        done(err, user); 
    });
});


app.listen(port, ()=>{
    console.log(`The app is listening at port ${port}`);
})