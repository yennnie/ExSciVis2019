#version 150
//#extension GL_ARB_shading_language_420pack : require
#extension GL_ARB_explicit_attrib_location : require

#define TASK 10
#define ENABLE_OPACITY_CORRECTION 0
#define ENABLE_LIGHTNING 0
#define ENABLE_SHADOWING 0

in vec3 ray_entry_position;

layout(location = 0) out vec4 FragColor;

uniform mat4 Modelview;

uniform sampler3D volume_texture;
uniform sampler2D transfer_texture;


uniform vec3    camera_location;
uniform float   sampling_distance;
uniform float   sampling_distance_ref;
uniform float   iso_value;
uniform vec3    max_bounds;
uniform ivec3   volume_dimensions;

uniform vec3    light_position;
uniform vec3    light_ambient_color;
uniform vec3    light_diffuse_color;
uniform vec3    light_specular_color;
uniform float   light_ref_coef;

bool pre_integrated = true;

bool
inside_volume_bounds(const in vec3 sampling_position)
{
    return (   all(greaterThanEqual(sampling_position, vec3(0.0)))
            && all(lessThanEqual(sampling_position, max_bounds)));
}


float
get_sample_data(vec3 in_sampling_pos)
{
    vec3 obj_to_tex = vec3(1.0) / max_bounds;
    return texture(volume_texture, in_sampling_pos * obj_to_tex).r;

}

vec3 get_gradient(vec3 pos) {

    vec3 step = max_bounds/volume_dimensions;
    vec3 gradient;
    gradient.x = (get_sample_data(vec3(pos.x+step.x, pos.y, pos.z)) - get_sample_data(vec3(pos.x-step.x, pos.y, pos.z)))/2;
    gradient.y = (get_sample_data(vec3(pos.x, pos.y+step.y, pos.z)) - get_sample_data(vec3(pos.x, pos.y-step.y, pos.z)))/2;
    gradient.z = (get_sample_data(vec3(pos.x, pos.y, pos.z+step.z)) - get_sample_data(vec3(pos.x, pos.y, pos.z-step.z)))/2;

    float dx = gradient.x;
    float dy = gradient.y;
    float dz = gradient.z;
    gradient = vec3(dx,dy,dz);

    return normalize(gradient);
}

vec4 get_color_and_opacity (float s) {
    vec4 color = texture(transfer_texture, vec2(s,s));
    return color;
}

vec4 shading (vec3 sampling_pos, vec4 color) {

    //diffuse
    vec3 light_direction = normalize(light_position - sampling_pos);
    vec3 gradient = normalize(get_gradient(sampling_pos));
    float diffuse_angle = dot(gradient, light_direction);
    vec3 diffuse_light = light_diffuse_color * max(0.0, diffuse_angle);

    //specular
    vec3 camera_direction = normalize(camera_location - sampling_pos);
    vec3 reflection = normalize(reflect(light_direction, gradient));
    float specular_angle = dot(camera_direction, reflection);
    float specular = pow(specular_angle, light_ref_coef);
    vec3 specular_light = light_specular_color * specular;

    //lighting
    vec3 lighting = light_ambient_color + diffuse_light + specular_light;
    return  color * vec4(lighting, 1.0);

}

// 2.2
vec4 apply_shading(vec3 sampling_pos, vec4 color) {
    // diffuse
    vec3 light_direction = normalize(light_position - sampling_pos);
    vec3 grad = normalize(get_gradient(sampling_pos));
    float diffuse_angle = dot(grad, light_direction);
    vec3 diffusion_light = light_diffuse_color * max(0.0, diffuse_angle);

    // specular
    vec3 camera_direction = normalize(camera_location - sampling_pos);
    vec3 reflection = normalize(reflect(light_direction, grad));
    float specular_angle = dot(camera_direction, reflection);
    float specular = pow(specular_angle, light_ref_coef);
    vec3 specular_light = light_specular_color * specular;

    // lighting
    vec3 lighting = light_ambient_color + diffusion_light + specular_light;
    return color * vec4(lighting, 1.0);
}

// 4.2
vec4 get_pre_integrated_result(vec3 sampling_pos, vec3 ray_increment) {
    vec4 result = vec4(0, 0, 0, 0);
    float distance = length(2 * ray_increment);
    float prev = get_sample_data(sampling_pos - ray_increment);
    float next = get_sample_data(sampling_pos + ray_increment);
    float opacity_integral = 0;
    float increment = 0.1;

    for (float i = 0; i <= 1; i += increment) {
        float current_value = (1 - i) * next + i * prev;
        vec4 current_color = get_color_and_opacity(current_value);
        opacity_integral += current_color.a;
    }

    float opacity = 1 - exp(-distance * opacity_integral);

    for (float i = 0; i < 1; i += increment) {
        float current_value = (1 - i) * next + i * prev;
        vec4 current_color = get_color_and_opacity(current_value);
        float current_opacity = 0;

        for (float j = i; j < 1; j += increment) {
            float current_j_value = (1 - j) * next + j * prev;
            vec4 current_j_color = get_color_and_opacity(current_j_value);
            current_opacity += current_j_color.a;
        }

        result += current_color * current_color.a * exp(-distance * current_opacity);
    }

    result.a = opacity;
    return result;
}

// 3.1
vec4 front_to_back(vec3 sampling_pos, bool inside_volume, vec3 ray_increment) {
    vec4 result = vec4(0.0, 0.0, 0.0, 0.0);
    float transparency = 1;

    while (inside_volume && transparency > 0)
    {
        float s = get_sample_data(sampling_pos);
        vec4 color = get_color_and_opacity(s);

        if (pre_integrated) {
            color = get_pre_integrated_result(sampling_pos, ray_increment);
        }

        float increment_factor = 1;

        #if ENABLE_OPACITY_CORRECTION == 1 // Opacity Correction
        float grad_magnitude = length(get_gradient(sampling_pos));
        increment_factor = 1 / (exp(grad_magnitude));
        color.a = 1 - pow((1 - color.a), increment_factor);
        #endif

        color *= transparency;
        result += color;
        transparency *= (1 - color.a);

        // increment the ray sampling position
        sampling_pos += ray_increment * increment_factor;

        // update the loop termination condition
        inside_volume = inside_volume_bounds(sampling_pos);
    }

        #if ENABLE_LIGHTNING == 1 // Add Shading
    result = apply_shading(sampling_pos, result);
    #endif

    return result;
}

// 3.2
vec4 back_to_front(vec3 sampling_pos, bool inside_volume, vec3 ray_increment) {
    vec4 result = vec4(0.0, 0.0, 0.0, 0.0);

    // get last sample position
    while (inside_volume)
    {
        sampling_pos += ray_increment;
        inside_volume = inside_volume_bounds(sampling_pos);
    }

    sampling_pos -= ray_increment;
    inside_volume = true;

    // traverse back to front
    while (inside_volume) {
        float s = get_sample_data(sampling_pos);
        vec4 color = get_color_and_opacity(s);

        if (pre_integrated) {
            color = get_pre_integrated_result(sampling_pos, ray_increment);
        }

        result = color * color.a + result * (1 - color.a);
        sampling_pos -= ray_increment;
        inside_volume = inside_volume_bounds(sampling_pos);
    }

    return result;
}

void main()
{
    /// One step trough the volume
    vec3 ray_increment = normalize(ray_entry_position - camera_location) * sampling_distance;

    /// Position in Volume
    vec3 sampling_pos = ray_entry_position + ray_increment; // test, increment just to be sure we are in the volume

    /// Init color of fragment
    vec4 dst = vec4(0.0, 0.0, 0.0, 0.0);

    /// check if we are inside volume
    bool inside_volume = inside_volume_bounds(sampling_pos);

    if (!inside_volume) {
        discard;
    }

        #if TASK == 10
    vec4 max_val = vec4(0.0, 0.0, 0.0, 0.0);

    // the traversal loop,
    // termination when the sampling position is outside volume boundarys
    // another termination condition for early ray termination is added
    while (inside_volume)
    {
        // get sample
        float s = get_sample_data(sampling_pos);

        // apply the transfer functions to retrieve color and opacity
        vec4 color = get_color_and_opacity(s);

        // this is the example for maximum intensity projection
        max_val.r = max(color.r, max_val.r);
        max_val.g = max(color.g, max_val.g);
        max_val.b = max(color.b, max_val.b);
        max_val.a = max(color.a, max_val.a);

        // increment the ray sampling position
        sampling_pos += ray_increment;

        // update the loop termination condition
        inside_volume = inside_volume_bounds(sampling_pos);
    }

    dst = max_val;
    #endif

    #if TASK == 11
    vec4 avg_val = vec4(0.0, 0.0, 0.0, 1.0);

    // store number of traversed points;
    int traversed_points = 0;

    // the traversal loop,
    // termination when the sampling position is outside volume boundarys
    // another termination condition for early ray termination is added
    while (inside_volume)
    {
        // increment traversed_points by 1 each iteration
        ++traversed_points;
        float s = get_sample_data(sampling_pos);
        vec4 color = get_color_and_opacity(s);

        // apply average intensity projection
        // calculate total using current sample, previous average and traversed_points
        avg_val.r = (color.r + avg_val.r * (traversed_points - 1)) / traversed_points;
        avg_val.g = (color.g + avg_val.g * (traversed_points - 1)) / traversed_points;
        avg_val.b = (color.b + avg_val.b * (traversed_points - 1)) / traversed_points;
        sampling_pos  += ray_increment;
        inside_volume  = inside_volume_bounds(sampling_pos);
    }

    dst = avg_val;
    #endif

    #if TASK == 12 || TASK == 13
    // the traversal loop,
    // termination when the sampling position is outside volume boundarys
    // another termination condition for early ray termination is added

    while (inside_volume)
    {
        // get sample
        float s = get_sample_data(sampling_pos);

        if (s >= iso_value) {
            vec3 intersection = sampling_pos;

            #if TASK == 13 // binary search
            // start point = previous point
            vec3 start_point = sampling_pos - ray_increment;
            vec3 end_point = sampling_pos;
            bool found = false;

            // find the point where value equals iso, stops if distance is between start and end is less than 1
            while (length(end_point - start_point) > 1) {
                vec3 mid_point = (end_point + start_point) / 2;

                // get sample
                float mid_value = get_sample_data(mid_point);

                if (mid_value >= iso_value) {
                    intersection = mid_point;

                    if (mid_value == iso_value) {
                        // stop searching
                        break;
                    }
                } else if (s < iso_value) {
                    start_point = mid_point;
                }
            }
                #endif

            float intersection_value = get_sample_data(intersection);
            vec4 color = get_color_and_opacity(intersection_value);
            dst = color;

            #if ENABLE_LIGHTNING == 1 // Add Shading
            dst = apply_shading(sampling_pos, color);
            #endif

            #if ENABLE_SHADOWING == 1 // Add Shadows
            // find the direction to cast the shadow ray
            vec3 shadow_ray_increment = normalize(sampling_pos - light_position) * sampling_distance;
            vec3 shadow_ray_position = sampling_pos + shadow_ray_increment;
            bool shadow_ray_inside_volume = inside_volume_bounds(shadow_ray_position);

            while (shadow_ray_inside_volume) {
                float shadow_value = get_sample_data(shadow_ray_position);

                if (shadow_value >= iso_value) {
                    // set color to black if shadow ray intersects with volume
                    dst = vec4(0.0, 0.0, 0.0, 0.0);
                    break;
                }

                shadow_ray_position += shadow_ray_increment;
                shadow_ray_inside_volume = inside_volume_bounds(shadow_ray_position);
            }
                #endif

            break;
        }

        // increment the ray sampling position
        sampling_pos += ray_increment;

        // update the loop termination condition
        inside_volume = inside_volume_bounds(sampling_pos);
    }
        #endif

        #if TASK == 31
    dst = front_to_back(sampling_pos, inside_volume, ray_increment);
    // dst = back_to_front(sampling_pos, inside_volume, ray_increment);
    #endif

    // return the calculated color value
    FragColor = dst;
}