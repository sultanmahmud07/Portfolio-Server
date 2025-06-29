const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const nodemailer = require("nodemailer");
const port = process.env.PORT || 5000;
const app = express();
// Cloudinary and Multer
const { v2: cloudinary } = require("cloudinary");
const multer = require("multer");

// Configure Multer to store files in memory
const upload = multer({ storage: multer.memoryStorage() });

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET,
});
// Nodemailer Transporter Configuration
const transporter = nodemailer.createTransport({
  service: 'Gmail', // Use the appropriate email service
  auth: {
    user: process.env.EMAIL_USER, // Your email address (from .env)
    pass: process.env.EMAIL_PASS  // Your email password or app-specific password (from .env)
  }
});

// Middleware>>>>
app.use(cors());
app.use(express.json());
const uri = `mongodb+srv://resumi_portfolio_bd:P00712345678@cluster0.x9muexx.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});


async function run() {
  try {
    const servicesCollection = client.db("portfolioDB").collection("services");
    const projectsCollection = client.db("portfolioDB").collection("projects");
    const projectCategoriesCollection = client.db("portfolioDB").collection("projectCategories");
    const contactQueriesCollection = client.db("portfolioDB").collection("contactQueries");
    const adminsCollection = client.db("portfolioDB").collection("admins");
    const blogsCollection = client.db("portfolioDB").collection("blogs");

    // ===============================================
    //      Admin authentication action start here 
    // ===============================================
    const verifyToken = (req, res, next) => {
      const authHeader = req.headers["authorization"];

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Unauthorized: Token missing" });
      }

      const token = authHeader && authHeader.split(" ")[1];

      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; // { id: ... }
        next();
      } catch (err) {
        return res.status(403).json({ message: "Forbidden: Invalid or expired token" });
      }
    };




    //================================================
    //       Projects category api action start here 
    // =====================================================
    app.post("/project/category/create", upload.single("image"), async (req, res) => {
      try {
        const { category_name, category_slug, status, order } = req.body;

        if (!category_name || !category_slug) {
          return res.status(400).json({ message: "Name and slug are required" });
        }

        // Ensure slug is unique
        const exists = await projectCategoriesCollection.findOne({ category_slug });
        if (exists) {
          return res.status(409).json({ message: "Slug must be unique" });
        }

        // Upload image if exists
        let imageUrl = null;
        if (req.file) {
          const base64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
          const uploadResult = await cloudinary.uploader.upload(base64, {
            folder: "portfolio_images/project_categories",
            public_id: category_slug,
            format: "webp",
            transformation: [
              {
                quality: "auto",
                width: 600,
                crop: "limit"
              }
            ]
          });
          imageUrl = uploadResult.secure_url;
        }

        const result = await projectCategoriesCollection.insertOne({
          category_name,
          category_slug,
          status,
          order: Number(order) || 0,
          image: imageUrl, // 👈 Save image URL here
          createdAt: new Date(),
        });

        res.status(201).json({
          message: "Category created",
          data: {
            _id: result.insertedId,
            category_name,
            category_slug,
            image: imageUrl
          },
        });

      } catch (error) {
        console.error("Category creation failed:", error);
        res.status(500).json({ message: "Failed to create category", error: error.message });
      }
    });

    app.get("/project/category/view", async (req, res) => {
      try {
        const categories = await projectCategoriesCollection.find().toArray();
        res.status(200).json(categories);
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch categories", error: error.message });
      }
    });
    app.get("/project/category/:id", async (req, res) => {
      try {
        const { id } = req.params;

        // Validate ObjectId
        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid category ID" });
        }

        const category = await projectCategoriesCollection.findOne({ _id: new ObjectId(id) });

        if (!category) {
          return res.status(404).json({ message: "Category not found" });
        }

        res.status(200).json(category);
      } catch (error) {
        console.error("Error fetching category by ID:", error);
        res.status(500).json({ message: "Internal Server Error", error: error.message });
      }
    });

    app.patch("/project/category/:id", upload.single("image"), async (req, res) => {
      try {
        const { id } = req.params;
        const { category_name, category_slug, status, order } = req.body;

        if (!category_name && !category_slug && !status && !order && !req.file) {
          return res.status(400).json({ message: "Nothing to update" });
        }

        // Get existing category
        const existing = await projectCategoriesCollection.findOne({ _id: new ObjectId(id) });
        if (!existing) {
          return res.status(404).json({ message: "Category not found" });
        }

        // Check if slug is changing and ensure it's unique
        if (category_slug && category_slug !== existing.category_slug) {
          const exists = await projectCategoriesCollection.findOne({
            category_slug,
            _id: { $ne: new ObjectId(id) }
          });
          if (exists) {
            return res.status(409).json({ message: "Slug must be unique" });
          }
        }

        // Handle image update
        let updatedImageUrl = existing.image;
        const effectiveSlug = category_slug || existing.category_slug;

        if (req.file) {
          // Delete old image from Cloudinary
          if (existing.image?.includes("res.cloudinary.com")) {
            const publicId = existing.category_slug;
            await cloudinary.uploader.destroy(`portfolio_images/project_categories/${publicId}`);
          }

          // Upload new image
          const base64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
          const uploadResult = await cloudinary.uploader.upload(base64, {
            folder: "portfolio_images/project_categories",
            public_id: effectiveSlug,
            format: "webp",
            transformation: [
              { quality: "auto", width: 600, crop: "limit" }
            ]
          });

          updatedImageUrl = uploadResult.secure_url;
        }

        // Prepare update object
        const updateDoc = {
          $set: {
            ...(category_name && { category_name }),
            ...(category_slug && { category_slug }),
            ...(status && { status }),
            ...(order && { order: Number(order) }),
            image: updatedImageUrl,
            updatedAt: new Date(),
          },
        };

        const result = await projectCategoriesCollection.updateOne(
          { _id: new ObjectId(id) },
          updateDoc
        );

        if (result.modifiedCount === 0) {
          return res.status(404).json({ message: "Category not updated or no changes" });
        }

        res.status(200).json({ message: "Category updated successfully" });

      } catch (error) {
        console.error("Category update failed:", error);
        res.status(500).json({ message: "Update failed", error: error.message });
      }
    });
    app.delete("/project/category/:id", async (req, res) => {
      try {
        const { id } = req.params;

        const result = await projectCategoriesCollection.deleteOne({ _id: new ObjectId(id) });

        if (result.deletedCount === 0) {
          return res.status(404).json({ message: "Category not found" });
        }

        res.status(200).json({ message: "Category deleted successfully" });
      } catch (error) {
        res.status(500).json({ message: "Delete failed", error: error.message });
      }
    });

    //================================================
    //       Projects api action start here 
    // =====================================================
    app.post("/project/create", upload.fields([
        { name: "feature_image", maxCount: 1 },
        { name: "images", maxCount: 10 },
      ]),async (req, res) => {
        try {
          const {
            name,
            slug,
            description,
            metaTitle,
            metaDescription,
            content,
            status,
            order_number,
            tags,
            budget,
            start_date,
            end_date,
            live_link,
            git_link,
            user_react,
            client_name,
            client_country,
            client_link,
            category_id,
            view_point
          } = req.body;

          // Slug & feature image required
          if (!slug || !req.files?.feature_image) {
            return res
              .status(400)
              .json({ message: "Slug and feature image are required" });
          }

          // Check slug uniqueness
          const existing = await projectsCollection.findOne({ slug });
          if (existing) {
            return res.status(409).json({ message: "Slug already exists" });
          }

          // ---------- Parse category_ids ----------
          let category_ids = category_id;
          if (typeof category_ids === "string") {
            try {
              category_ids = JSON.parse(category_ids);
            } catch (e) {
              return res
                .status(400)
                .json({ message: "Invalid category_id format. Must be an array." });
            }
          }

          if (!Array.isArray(category_ids) || category_ids.length === 0) {
            return res
              .status(400)
              .json({ message: "category_id must be a non-empty array." });
          }

          const objectIds = category_ids.map((id) => new ObjectId(id));
          const validCategories = await projectCategoriesCollection
            .find({ _id: { $in: objectIds } })
            .toArray();

          if (validCategories.length !== category_ids.length) {
            return res
              .status(400)
              .json({ message: "One or more category_id values are invalid." });
          }

          // ---------- Parse view_point ----------
          let parsedViewPoint = [];
          if (view_point) {
            if (typeof view_point === "string") {
              try {
                parsedViewPoint = JSON.parse(view_point);
              } catch (e) {
                return res
                  .status(400)
                  .json({ message: "Invalid view_point format. Must be an array." });
              }
            } else if (Array.isArray(view_point)) {
              parsedViewPoint = view_point;
            }
          }

          // ---------- Upload feature image ----------
          const featureImageFile = req.files.feature_image[0];
          const featureBase64 = `data:${featureImageFile.mimetype};base64,${featureImageFile.buffer.toString("base64")}`;
          const featureUpload = await cloudinary.uploader.upload(featureBase64, {
            folder: "portfolio_images/projects/feature_images",
            public_id: slug,
            resource_type: "image",
            format: "webp",
            transformation: [
              {
                quality: "auto",
                fetch_format: "auto",
                width: 1200,
                crop: "limit",
              },
            ],
          });

          // ---------- Upload multiple images ----------
          const imageUrls = [];
          if (req.files.images) {
            for (const file of req.files.images) {
              const base64Image = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
              const uploadResult = await cloudinary.uploader.upload(base64Image, {
                folder: "portfolio_images/projects",
                resource_type: "image",
                format: "webp",
                transformation: [
                  {
                    quality: "auto",
                    fetch_format: "auto",
                    width: 1200,
                    crop: "limit",
                  },
                ],
              });
              imageUrls.push(uploadResult.secure_url);
            }
          }

          // ---------- Prepare project data ----------
          const projectData = {
            name,
            slug,
            description,
            metaTitle,
            metaDescription,
            content,
            status,
            tags,
            budget,
            order_number,
            view_point: parsedViewPoint,
            start_date,
            end_date,
            live_link,
            git_link,
            user_react: Number(user_react) || 0,
            category_ids: objectIds,
            client_info: {
              name: client_name,
              country: client_country,
              link: client_link,
            },
            feature_image: featureUpload.secure_url,
            images: imageUrls,
            createdAt: new Date(),
          };

          const result = await projectsCollection.insertOne(projectData);

          res.status(201).json({
            message: "Project created successfully",
            data: {
              _id: result.insertedId,
              ...projectData,
            },
          });
        } catch (err) {
          console.error("Project creation failed:", err);
          res.status(500).json({ message: "Internal Server Error", error: err.message });
        }
      }
    );


    app.patch("/project/update/:id", upload.fields([
      { name: "feature_image", maxCount: 1 },
      { name: "images", maxCount: 10 }
    ]), async (req, res) => {
      try {
        const { id } = req.params;
        const {
          name,
          slug,
          description,
          metaTitle,
          metaDescription,
          content,
          status,
          tags,
          start_date,
          end_date,
          live_link,
          git_link,
          user_react,
          client_name,
          client_country,
          client_link,
          category_id // 👈 NEW
        } = req.body;

        const existing = await projectsCollection.findOne({ _id: new ObjectId(id) });
        if (!existing) return res.status(404).json({ message: "Project not found" });

        // Slug uniqueness check
        if (slug && slug !== existing.slug) {
          const slugExists = await projectsCollection.findOne({ slug, _id: { $ne: new ObjectId(id) } });
          if (slugExists) return res.status(409).json({ message: "Slug already exists" });
        }

        // Category validation
        if (category_id) {
          const validCategory = await projectCategoriesCollection.findOne({ _id: new ObjectId(category_id) });
          if (!validCategory) {
            return res.status(400).json({ message: "Invalid category_id" });
          }
        }

        let updatedFeatureImage = existing.feature_image;
        let updatedImages = existing.images || [];

        // Update feature image
        if (req.files?.feature_image) {
          if (existing.feature_image?.includes("res.cloudinary.com")) {
            await cloudinary.uploader.destroy(`portfolio_images/projects/feature_images/${existing.slug}`);
          }

          const file = req.files.feature_image[0];
          const base64 = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
          const upload = await cloudinary.uploader.upload(base64, {
            folder: "portfolio_images/projects/feature_images",
            public_id: slug || existing.slug,
            resource_type: "image",
            format: "webp",
            transformation: [{ quality: "auto", width: 1200, crop: "limit" }]
          });

          updatedFeatureImage = upload.secure_url;
        }

        // Update gallery images
        if (req.files?.images) {
          const destroyOld = (existing.images || []).map(url => {
            const name = url.split("/").pop().split(".")[0];
            return cloudinary.uploader.destroy(`portfolio_images/projects/${name}`);
          });
          await Promise.all(destroyOld);

          updatedImages = [];
          for (const file of req.files.images) {
            const base64 = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
            const upload = await cloudinary.uploader.upload(base64, {
              folder: "portfolio_images/projects",
              format: "webp",
              transformation: [{ quality: "auto", width: 1200, crop: "limit" }]
            });
            updatedImages.push(upload.secure_url);
          }
        }

        const updateFields = {
          ...(name && { name }),
          ...(slug && { slug }),
          ...(description && { description }),
          ...(metaTitle && { metaTitle }),
          ...(metaDescription && { metaDescription }),
          ...(content && { content }),
          ...(status && { status }),
          ...(tags && { tags }),
          ...(start_date && { start_date }),
          ...(end_date && { end_date }),
          ...(live_link && { live_link }),
          ...(git_link && { git_link }),
          ...(user_react && { user_react: Number(user_react) }),
          ...(category_id && { category_id: new ObjectId(category_id) }),
          feature_image: updatedFeatureImage,
          images: updatedImages,
          client_info: {
            name: client_name || existing.client_info?.name,
            country: client_country || existing.client_info?.country,
            link: client_link || existing.client_info?.link
          }
        };

        await projectsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateFields }
        );

        res.status(200).json({ message: "Project updated successfully" });

      } catch (err) {
        console.error("Project update failed:", err);
        res.status(500).json({ message: "Internal Server Error", error: err.message });
      }
    });

    app.get("/projects/view-all", async (req, res) => {
      try {
        const projects = await projectsCollection.find({}).sort({ createdAt: -1 }).toArray();
        res.status(200).json(projects);
      } catch (err) {
        console.error("Error fetching all projects:", err);
        res.status(500).json({ message: "Internal Server Error", error: err.message });
      }
    });

    app.delete("/project/delete/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const project = await projectsCollection.findOne({ _id: new ObjectId(id) });

        if (!project) return res.status(404).json({ message: "Project not found" });

        // Delete feature image
        if (project.feature_image?.includes("res.cloudinary.com")) {
          await cloudinary.uploader.destroy(`portfolio_projects/feature_images/${project.slug}`);
        }

        // Delete gallery images
        if (Array.isArray(project.images)) {
          const destroyPromises = project.images.map(url => {
            const fileName = url.split("/").pop().split(".")[0];
            return cloudinary.uploader.destroy(`portfolio_projects/gallery/${fileName}`);
          });
          await Promise.all(destroyPromises);
        }

        await projectsCollection.deleteOne({ _id: new ObjectId(id) });

        res.status(200).json({ message: "Project deleted successfully" });
      } catch (err) {
        console.error("Project deletion failed:", err);
        res.status(500).json({ message: "Internal Server Error", error: err.message });
      }
    });
    app.get("/project/view/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const project = await projectsCollection.findOne({ _id: new ObjectId(id) });
        if (!project) return res.status(404).json({ message: "Project not found" });

        res.status(200).json(project);
      } catch (err) {
        console.error("Get by ID failed:", err);
        res.status(500).json({ message: "Internal Server Error", error: err.message });
      }
    });
    app.get("/project/slug/:slug", async (req, res) => {
      try {
        const { slug } = req.params;
        const project = await projectsCollection.findOne({ slug });
        if (!project) return res.status(404).json({ message: "Project not found" });

        res.status(200).json(project);
      } catch (err) {
        console.error("Get by slug failed:", err);
        res.status(500).json({ message: "Internal Server Error", error: err.message });
      }
    });



    //================================================
    //       Service api action start here 
    // =====================================================
    app.post("/create-service", upload.single("image"), async (req, res) => {
      try {
        const {
          name,
          slug,
          description,
          metaTitle,
          metaDescription,
          content,
          status,
          tags
        } = req.body;

        if (!req.file) {
          return res.status(400).json({ message: "Image file is required" });
        }

        if (!slug) {
          return res.status(400).json({ message: "Slug is required" });
        }

        // Check for duplicate slug
        const existing = await servicesCollection.findOne({ slug });
        if (existing) {
          return res.status(409).json({ message: "Slug already exists. Please use a unique slug." });
        }


        // Convert image to base64
        const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;

        // Upload to Cloudinary
        const result = await cloudinary.uploader.upload(base64Image, {
          folder: "portfolio_images/services",
          public_id: slug,
          resource_type: "image",
        });

        const serviceData = {
          name,
          slug,
          description,
          metaTitle,
          metaDescription,
          content,
          status,
          image: result.secure_url,
          tags,
          createdAt: new Date(),
        };

        const dbResult = await servicesCollection.insertOne(serviceData);

        res.status(201).json({
          message: "Service created successfully",
          data: {
            _id: dbResult.insertedId,
            ...serviceData,
          },
        });
      } catch (err) {
        console.error("Service creation failed:", err);
        res.status(500).json({ message: "Internal Server Error", error: err.message });
      }
    });
    // Update service api here ==================
    app.patch("/update-service/:id", upload.single("image"), async (req, res) => {
      try {
        const { id } = req.params;
        const {
          name,
          slug,
          description,
          content,
          status,
        } = req.body;

        // Find existing service
        const existingService = await servicesCollection.findOne({ _id: new ObjectId(id) });
        if (!existingService) {
          return res.status(404).json({ message: "Service not found" });
        }

        // Check for slug uniqueness (if updated)
        if (slug && slug !== existingService.slug) {
          const slugExists = await servicesCollection.findOne({
            slug,
            _id: { $ne: new ObjectId(id) },
          });

          if (slugExists) {
            return res.status(409).json({ message: "Slug already exists. Use a unique one." });
          }
        }

        let imageUrl = existingService.image;

        // If new image is uploaded
        if (req.file) {
          // Delete old image from Cloudinary
          if (existingService.image?.includes("res.cloudinary.com")) {
            const publicId = existingService.image
              .split("/")
              .slice(-1)[0]
              .split(".")[0]; // Extract file name

            await cloudinary.uploader.destroy(`portfolio_images/services/${publicId}`);
          }

          // Upload new image
          const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
          const result = await cloudinary.uploader.upload(base64Image, {
            folder: "portfolio_images/services",
            public_id: slug || undefined,
            resource_type: "image",
          });

          imageUrl = result.secure_url;
        }


        // Prepare partial update
        const updatedFields = {
          ...(name && { name }),
          ...(slug && { slug }),
          ...(description && { description }),
          ...(content && { content }),
          ...(status && { status }),
          ...(imageUrl && { image: imageUrl }),
        };

        await servicesCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedFields }
        );

        res.status(200).json({ message: "Service updated successfully" });
      } catch (err) {
        console.error("Service update failed:", err);
        res.status(500).json({ message: "Internal Server Error", error: err.message });
      }
    });
    // Delete service api here ==================
    app.delete("/delete-service/:id", async (req, res) => {
      try {
        const { id } = req.params;

        // Check if service exists
        const service = await servicesCollection.findOne({ _id: new ObjectId(id) });
        if (!service) {
          return res.status(404).json({ message: "Service not found" });
        }

        // Delete image from Cloudinary if hosted there
        if (service.image?.includes("res.cloudinary.com")) {
          const publicId = service.image
            .split("/")
            .slice(-1)[0]
            .split(".")[0]; // Extract file name without extension

          await cloudinary.uploader.destroy(`portfolio_images/services/${publicId}`);
        }

        // Delete service from database
        await servicesCollection.deleteOne({ _id: new ObjectId(id) });

        res.status(200).json({ message: "Service deleted successfully" });
      } catch (err) {
        console.error("Service deletion failed:", err);
        res.status(500).json({ message: "Internal Server Error", error: err.message });
      }
    });
    app.get("/services", async (req, res) => {
      const query = {};
      const services = await servicesCollection.find(query).toArray();
      res.send(services);
    });
    app.get("/service/:slug", async (req, res) => {
      try {
        const { slug } = req.params;

        const service = await servicesCollection.findOne({ slug });

        if (!service) {
          return res.status(404).json({ message: "Service not found" });
        }

        res.status(200).json(service);
      } catch (err) {
        console.error("Error fetching service by slug:", err);
        res.status(500).json({ message: "Internal Server Error", error: err.message });
      }
    });
    app.get("/services/filter-by-viewpoint", async (req, res) => {
      try {
        const { view_point } = req.query;

        if (!view_point) {
          return res.status(400).json({ message: "view_point query is required" });
        }

        const filterValues = view_point.split(",").map((v) => v.trim().toLowerCase());

        // Fetch all and manually filter stringified view_point
        const allServices = await servicesCollection.find({}).toArray();

        const filtered = allServices.filter((service) => {
          try {
            const vpArray = JSON.parse(service.view_point); // Convert stringified array
            return vpArray.some((vp) => filterValues.includes(vp.toLowerCase()));
          } catch (e) {
            return false;
          }
        });

        res.status(200).json(filtered);
      } catch (err) {
        console.error("Error filtering by view_point:", err);
        res.status(500).json({ message: "Internal Server Error", error: err.message });
      }
    });


    //================================================
    //       Blogs api action start here 
    // =====================================================
    app.post("/create-blog", upload.single("image"), async (req, res) => {
      try {
        const {
          title,
          slug,
          category,
          metaTitle,
          metaDescription,
          description,
          readTime,
          commentCount,
          tags,
          content,
        } = req.body;

        if (!slug) return res.status(400).json({ message: "Slug is required" });

        const existing = await blogsCollection.findOne({ slug });
        if (existing) return res.status(409).json({ message: "Slug already exists" });

        const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
        const result = await cloudinary.uploader.upload(base64Image, {
          folder: "portfolio_images/blogs",
          public_id: slug,
          resource_type: "image",
        });

        const blog = {
          title,
          slug,
          category,
          metaTitle,
          metaDescription,
          description,
          readTime,
          commentCount,
          tags: Array.isArray(tags) ? tags : JSON.parse(tags),
          content,
          image: result.secure_url,
          createdAt: new Date(),
        };

        const insertResult = await blogsCollection.insertOne(blog);
        res.status(201).json({ message: "Blog created", data: { _id: insertResult.insertedId, ...blog } });
      } catch (err) {
        res.status(500).json({ message: "Internal Server Error", error: err.message });
      }
    });
    app.patch("/blog/:id", upload.single("image"), async (req, res) => {
      try {
        const { id } = req.params;
        const blog = await blogsCollection.findOne({ _id: new ObjectId(id) });
        if (!blog) return res.status(404).json({ message: "Blog not found" });

        const {
          title,
          slug,
          category,
          metaTitle,
          metaDescription,
          description,
          readTime,
          commentCount,
          tags,
          content,
        } = req.body;

        let imageUrl = blog.image;
        if (req.file) {
          const publicId = blog.image?.split("/").pop().split(".")[0];
          await cloudinary.uploader.destroy(`portfolio_images/blogs/${publicId}`);

          const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
          const result = await cloudinary.uploader.upload(base64Image, {
            folder: "portfolio_images/blogs",
            public_id: slug || blog.slug,
            resource_type: "image",
          });

          imageUrl = result.secure_url;
        }

        const updatedData = {
          ...(title && { title }),
          ...(slug && { slug }),
          ...(category && { category }),
          ...(metaTitle && { metaTitle }),
          ...(metaDescription && { metaDescription }),
          ...(description && { description }),
          ...(readTime && { readTime }),
          ...(commentCount && { commentCount }),
          ...(tags && { tags: Array.isArray(tags) ? tags : JSON.parse(tags) }),
          ...(content && { content }),
          ...(imageUrl && { image: imageUrl }),
        };

        await blogsCollection.updateOne({ _id: new ObjectId(id) }, { $set: updatedData });
        res.status(200).json({ message: "Blog updated" });
      } catch (err) {
        res.status(500).json({ message: "Internal Server Error", error: err.message });
      }
    });
    app.delete("/blog/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const blog = await blogsCollection.findOne({ _id: new ObjectId(id) });
        if (!blog) return res.status(404).json({ message: "Blog not found" });

        const publicId = blog.image?.split("/").pop().split(".")[0];
        await cloudinary.uploader.destroy(`portfolio_images/blogs/${publicId}`);
        await blogsCollection.deleteOne({ _id: new ObjectId(id) });

        res.status(200).json({ message: "Blog deleted" });
      } catch (err) {
        res.status(500).json({ message: "Internal Server Error", error: err.message });
      }
    });
    app.get("/blogs", async (req, res) => {
      try {
        const blogs = await blogsCollection.find().sort({ createdAt: -1 }).toArray();
        res.status(200).json(blogs);
      } catch (err) {
        res.status(500).json({ message: "Internal Server Error", error: err.message });
      }
    });
    app.get("/blog/:slug", async (req, res) => {
      try {
        const { slug } = req.params;

        const blog = await blogsCollection.findOne({ slug });

        if (!blog) {
          return res.status(404).json({ message: "Blog not found" });
        }

        res.status(200).json(blog);
      } catch (err) {
        console.error("Error fetching blog:", err);
        res.status(500).json({ message: "Internal Server Error", error: err.message });
      }
    });
    app.get("/blog/:id", async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid blog ID" });
        }

        const blog = await blogsCollection.findOne({ _id: new ObjectId(id) });

        if (!blog) {
          return res.status(404).json({ message: "Blog not found" });
        }

        res.status(200).json(blog);
      } catch (err) {
        console.error("Error fetching blog:", err);
        res.status(500).json({ message: "Internal Server Error", error: err.message });
      }
    });

    //================================================
    //       Contact query api action start here 
    // =====================================================
    app.post('/contact-request', async (req, res) => {
      const { firstName, lastName, email, phone, message } = req.body;

      const contactRequest = {
        name: `${firstName} ${lastName}`.trim(),
        email,
        phone,
        message,
        createdAt: new Date()
      };

      // Save to DB
      const result = await contactQueriesCollection.insertOne(contactRequest);

      // Email HTML
      const emailContent = `
    <h3>New Contact Request from Portfolio</h3>
    <table style="border-collapse: collapse; width: 100%; font-family: Arial, sans-serif;">
      <tr>
        <th style="border: 1px solid #dddddd; padding: 8px; background-color: #f2f2f2;">Field</th>
        <th style="border: 1px solid #dddddd; padding: 8px; background-color: #f2f2f2;">Details</th>
      </tr>
      <tr>
        <td style="border: 1px solid #dddddd; padding: 8px;">Name</td>
        <td style="border: 1px solid #dddddd; padding: 8px;">${contactRequest.name}</td>
      </tr>
      <tr>
        <td style="border: 1px solid #dddddd; padding: 8px;">Email</td>
        <td style="border: 1px solid #dddddd; padding: 8px;">${email}</td>
      </tr>
      <tr>
        <td style="border: 1px solid #dddddd; padding: 8px;">Phone</td>
        <td style="border: 1px solid #dddddd; padding: 8px;">${phone}</td>
      </tr>
      <tr>
        <td style="border: 1px solid #dddddd; padding: 8px;">Message</td>
        <td style="border: 1px solid #dddddd; padding: 8px;">${message}</td>
      </tr>
    </table>
    <p style="font-family: Arial, sans-serif; color: #555;">This is a service query message. Please do reply as soon as possible.</p>
  `;

      // Email options
      const mailOptions = {
        from: email,
        to: process.env.EMAIL_USER,
        subject: `New Contact Request from ${contactRequest.name}`,
        html: emailContent,
      };

      // Send email
      transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
          console.error("Email error:", error);
          return res.status(500).send({ message: 'Failed to send email', error });
        } else {
          console.log("Email sent:", info.response);
          return res.status(200).send({
            message: 'Contact request received and email sent successfully',
            result
          });
        }
      });
    });
    app.get('/contact-requests-view', async (req, res) => {
      try {
        const contactRequests = await contactQueriesCollection
          .find({})
          .sort({ createdAt: -1 }) // latest first
          .toArray();

        res.status(200).json({
          message: "Contact requests fetched successfully",
          data: contactRequests
        });
      } catch (error) {
        console.error("Failed to fetch contact requests:", error);
        res.status(500).json({
          message: "Internal Server Error",
          error: error.message
        });
      }
    });
    app.get('/contact-request/:id', async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid ID format" });
        }

        const request = await contactQueriesCollection.findOne({ _id: new ObjectId(id) });

        if (!request) {
          return res.status(404).json({ message: "Contact request not found" });
        }

        res.status(200).json({ message: "Contact request fetched", data: request });
      } catch (error) {
        console.error("Error getting contact request:", error);
        res.status(500).json({ message: "Server error", error: error.message });
      }
    });
    app.patch('/contact-request/:id', async (req, res) => {
      try {
        const { id } = req.params;
        const { name, email, phone, message } = req.body;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid ID format" });
        }

        const updateFields = {
          ...(name && { name }),
          ...(email && { email }),
          ...(phone && { phone }),
          ...(message && { message }),
          updatedAt: new Date()
        };

        const result = await contactQueriesCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateFields }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "Contact request not found" });
        }

        res.status(200).json({ message: "Contact request updated successfully" });
      } catch (error) {
        console.error("Error updating contact request:", error);
        res.status(500).json({ message: "Server error", error: error.message });
      }
    });
    app.delete('/contact-request/:id', async (req, res) => {
      try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
          return res.status(400).json({ message: "Invalid ID format" });
        }

        const result = await contactQueriesCollection.deleteOne({ _id: new ObjectId(id) });

        if (result.deletedCount === 0) {
          return res.status(404).json({ message: "Contact request not found" });
        }

        res.status(200).json({ message: "Contact request deleted successfully" });
      } catch (error) {
        console.error("Error deleting contact request:", error);
        res.status(500).json({ message: "Server error", error: error.message });
      }
    });


    app.post("/admin/register", verifyToken, async (req, res) => {
      try {
        const { name, email, phone, password } = req.body;

        // Check existing
        const existingAdmin = await adminsCollection.findOne({ email });
        if (existingAdmin) {
          return res.status(409).json({ message: "Admin already exists with this email" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newAdmin = {
          name,
          email,
          phone,
          password: hashedPassword,
          role: "admin",
          createdAt: new Date(),
        };

        const result = await adminsCollection.insertOne(newAdmin);

        const token = jwt.sign({ id: result.insertedId, email }, process.env.JWT_SECRET, {
          expiresIn: "7d",
        });

        res.status(201).json({
          message: "Admin registered successfully",
          data: {
            ...newAdmin,
            _id: result.insertedId,
            token,
          },
        });
      } catch (err) {
        console.error("Admin registration failed:", err);
        res.status(500).json({ message: "Internal Server Error", error: err.message });
      }
    });
    app.post("/admin/login", async (req, res) => {
      try {
        const { email, password } = req.body;

        const admin = await adminsCollection.findOne({ email });
        if (!admin) {
          return res.status(404).json({ message: "Admin not found" });
        }

        const isMatch = await bcrypt.compare(password, admin.password);
        if (!isMatch) {
          return res.status(401).json({ message: "Invalid password" });
        }

        const token = jwt.sign(
          { id: admin._id },
          process.env.JWT_SECRET,
          { expiresIn: '7d' }
        );

        res.status(200).json({
          message: "Login successful",
          data: {
            ...admin,
            token,
          },
        });
      } catch (err) {
        console.error("Admin login failed:", err);
        res.status(500).json({ message: "Internal Server Error", error: err.message });
      }
    });
    app.get("/admins", verifyToken, async (req, res) => {
      try {
        const admins = await adminsCollection.find().project({ password: 0 }).toArray();
        res.status(200).json(admins);
      } catch (err) {
        res.status(500).json({ message: "Internal Server Error", error: err.message });
      }
    });
    app.get("/admin/profile/:id", verifyToken, async (req, res) => {
      try {
        const { id } = req.params;
        if (req.user.id !== id) {
          return res.status(403).json({ message: "Forbidden: You can't access this profile" });
        }

        const admin = await adminsCollection.findOne(
          { _id: new ObjectId(id) },
          { projection: { password: 0 } }
        );

        if (!admin) {
          return res.status(404).json({ message: "Admin not found" });
        }

        res.status(200).json(admin);
      } catch (err) {
        console.error("Error getting profile:", err);
        res.status(500).json({ message: "Internal Server Error", error: err.message });
      }
    });
    app.delete("/admin/:id", verifyToken, async (req, res) => {
      const { id } = req.params;
      // console.log(id)
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid admin ID" });
      }

      const result = await adminsCollection.deleteOne({ _id: new ObjectId(id) });

      if (result.deletedCount === 0) {
        return res.status(404).json({ message: "Admin not found" });
      }

      res.status(200).json({ message: "Admin deleted successfully" });
    });




  } finally {
    // You can close the connection here if needed
  }
}

run().catch(console.log);

app.get("/", (req, res) => {
  res.send("Portfolio server is running...");
});

app.listen(port, () => {
  console.log(`Portfolio project running on port ${port}`);
});
